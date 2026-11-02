"""비밀번호 암호화와 확인."""
import bcrypt


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# 없는 아이디로 로그인해도 걸리는 시간이 같도록, 비교용으로 쓰는 가짜 암호문
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def verify_password(password, password_hash):
    """password_hash가 None이면 (없는 아이디) 항상 False. 걸리는 시간은 비슷하게 맞춘다."""
    target = password_hash or _DUMMY_HASH
    ok = bcrypt.checkpw(password.encode("utf-8"), target.encode("utf-8"))
    return ok and password_hash is not None
