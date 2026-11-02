"""DB 연결 모음(connection pool)."""
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def make_pool(database_url, schema=None):
    """schema를 주면 그 영역만 쓰는 연결을 만든다. (시험이 실제 데이터를 건드리지 않게 하려는 용도)"""

    def configure(conn):
        if schema:
            conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            conn.commit()

    return ConnectionPool(
        database_url,
        min_size=1,
        max_size=5,
        open=False,
        configure=configure,
        kwargs={"row_factory": dict_row, "prepare_threshold": None},
    )
