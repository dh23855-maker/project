"""문의 현황 시험: 날짜별·종류별 건수, 한국 시간 기준 날짜 경계, 기간 선택, 로그인 확인.

임시 DB 영역의 문의 시각과 종류를 정해진 값으로 바꿔 놓고 센다.
"""
from app.stats import BAD_DAYS_MESSAGE, DAY_CHOICES, UNCLASSIFIED
from ml.labels import LABELS
from tests.base import ApiTestBase

A, B = "buyer_delivery", "seller_penalty"


class StatsTest(ApiTestBase):
    def place(self, rows):
        """모든 문의를 먼 과거로 보내고, rows = [(며칠 전, 한국 시각 'HH:MM', 종류)]의 문의만 그 시각으로 바꾼다."""
        with self.connect() as conn:
            ids = [r["id"] for r in conn.execute("SELECT id FROM inquiries ORDER BY id").fetchall()]
            self.assertGreaterEqual(len(ids), len(rows))
            conn.execute(
                "UPDATE inquiries SET created_at = now() - interval '200 days', predicted_label = %s",
                (A,),
            )
            for inquiry_id, (ago, clock, label) in zip(ids, rows):
                conn.execute(
                    """
                    UPDATE inquiries
                    SET created_at = (((now() AT TIME ZONE 'Asia/Seoul')::date - %s) + %s::time) AT TIME ZONE 'Asia/Seoul',
                        predicted_label = %s
                    WHERE id = %s
                    """,
                    (ago, clock, label, inquiry_id),
                )
            conn.commit()

    def get(self, days=None):
        kim = self.login("kim")
        response = kim.get("/api/stats/inquiries" + (f"?days={days}" if days else ""))
        return response

    def test_counts_per_day_and_type(self):
        self.place([(0, "09:00", A), (0, "10:00", A), (0, "11:00", B), (1, "09:00", B), (3, "09:00", A)])
        body = self.get(7).json()
        self.assertEqual(body["days"], 7)
        self.assertEqual(body["total"], 5)
        self.assertEqual(len(body["daily"]), 7)
        by_ago = {7 - 1 - n: day for n, day in enumerate(body["daily"])}  # 며칠 전 -> 그날
        self.assertEqual(by_ago[0]["total"], 3)
        self.assertEqual(by_ago[0]["counts"][A], 2)
        self.assertEqual(by_ago[0]["counts"][B], 1)
        self.assertEqual(by_ago[1]["counts"][B], 1)
        self.assertEqual(by_ago[2]["total"], 0)  # 문의가 없는 날도 0건으로 나온다
        self.assertEqual(by_ago[3]["counts"][A], 1)
        # 날짜는 오래된 날부터 오늘까지
        self.assertEqual([d["date"] for d in body["daily"]], sorted(d["date"] for d in body["daily"]))
        self.assertEqual(body["daily"][-1]["date"], body["end"])
        self.assertEqual(body["daily"][0]["date"], body["start"])

    def test_types_are_all_seven_in_fixed_order_with_totals_and_percent(self):
        self.place([(0, "09:00", A), (0, "10:00", A), (0, "11:00", A), (1, "09:00", B)])
        body = self.get(7).json()
        self.assertEqual([t["code"] for t in body["types"]], LABELS)
        by_code = {t["code"]: t for t in body["types"]}
        self.assertEqual(by_code[A]["count"], 3)
        self.assertEqual(by_code[A]["percent"], 75.0)
        self.assertEqual(by_code[B]["percent"], 25.0)
        self.assertEqual(by_code["buyer_payment"]["count"], 0)
        self.assertEqual(by_code[A]["name"], "배송")
        self.assertEqual(by_code[A]["who"], "구매자")
        self.assertEqual(sum(t["count"] for t in body["types"]), body["total"])
        # 모든 종류가 모든 날짜에 들어 있다 (그래프를 그릴 때 빠진 칸이 없다)
        for day in body["daily"]:
            self.assertEqual(sorted(day["counts"]), sorted(LABELS))

    def test_period_choices_cut_at_the_right_day(self):
        # 6일 전은 7일 안에 들어오고, 7일 전은 들어오지 않는다
        self.place([(0, "09:00", A), (6, "09:00", A), (7, "09:00", B), (13, "09:00", B), (14, "09:00", B), (29, "09:00", A), (30, "09:00", A)])
        self.assertEqual(self.get(7).json()["total"], 2)
        self.assertEqual(self.get(14).json()["total"], 4)
        self.assertEqual(self.get(30).json()["total"], 6)
        self.assertEqual(len(self.get(30).json()["daily"]), 30)

    def test_default_period_is_14_days(self):
        self.place([(13, "09:00", A), (14, "09:00", A)])
        body = self.get().json()
        self.assertEqual((body["days"], body["total"]), (14, 1))

    def test_day_is_counted_in_korean_time(self):
        # 한국 시간 00:30과 23:30은 같은 날 안의 서로 다른 시각이다 (UTC로 보면 날짜가 갈린다)
        self.place([(2, "00:30", A), (2, "23:30", B), (1, "00:05", A)])
        body = self.get(7).json()
        by_ago = {6 - n: day for n, day in enumerate(body["daily"])}
        self.assertEqual(by_ago[2]["total"], 2)
        self.assertEqual(by_ago[1]["total"], 1)

    def test_inquiries_without_a_type_are_counted_as_unclassified(self):
        self.place([(0, "09:00", A)])
        with self.connect() as conn:
            inquiry_id = conn.execute("SELECT id FROM inquiries ORDER BY id LIMIT 1").fetchone()["id"]
            conn.execute("UPDATE inquiries SET predicted_label = NULL WHERE id = %s", (inquiry_id,))
            conn.commit()
        body = self.get(7).json()
        codes = [t["code"] for t in body["types"]]
        self.assertEqual(codes, LABELS + [UNCLASSIFIED])
        self.assertEqual(body["types"][-1]["name"], "분류 없음")
        self.assertEqual(body["types"][-1]["count"], 1)
        self.assertEqual(body["daily"][-1]["counts"][UNCLASSIFIED], 1)

    def test_no_inquiries_gives_zero_everywhere(self):
        self.place([])
        body = self.get(7).json()
        self.assertEqual(body["total"], 0)
        self.assertTrue(all(t["count"] == 0 and t["percent"] == 0.0 for t in body["types"]))
        self.assertTrue(all(d["total"] == 0 for d in body["daily"]))

    def test_bad_period_is_rejected(self):
        for days in ("5", "0", "-7", "365", "abc"):
            response = self.login("kim").get(f"/api/stats/inquiries?days={days}")
            self.assertIn(response.status_code, (400, 422), days)
        self.assertEqual(self.get(8).status_code, 400)
        self.assertEqual(self.get(8).json()["detail"], BAD_DAYS_MESSAGE)
        self.assertEqual(DAY_CHOICES, (7, 14, 30))

    def test_login_is_required(self):
        self.assertEqual(self.new_client().get("/api/stats/inquiries").status_code, 401)

    def test_every_agent_sees_the_same_numbers(self):
        self.place([(0, "09:00", A), (1, "09:00", B)])
        kim = self.login("kim").get("/api/stats/inquiries?days=7").json()
        park = self.login("park").get("/api/stats/inquiries?days=7").json()
        self.assertEqual(kim, park)
