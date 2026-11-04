"""문의 현황 시험: 날짜·시간대별 건수, 규정 문서에는 없음 비율, 확신도, 처리 현황, 한국 시간 경계, 기간 선택, 로그인 확인.

임시 DB 영역의 문의 시각과 종류 등을 정해진 값으로 바꿔 놓고 센다.
"""
from app.stats import BAD_DAYS_MESSAGE, DAY_CHOICES, UNCLASSIFIED
from ml.labels import LABELS
from tests.base import ApiTestBase

A, B = "buyer_delivery", "seller_penalty"


class StatsTest(ApiTestBase):
    def place(self, rows):
        """모든 문의를 먼 과거로 보내고, rows = [(며칠 전, 한국 시각 'HH:MM', 종류)]의 문의만 그 시각으로 바꾼다.

        돌려주는 값: rows에 해당하는 문의 번호 목록 (같은 순서).
        """
        with self.connect() as conn:
            ids = [r["id"] for r in conn.execute("SELECT id FROM inquiries ORDER BY id").fetchall()]
            self.assertGreaterEqual(len(ids), len(rows))
            conn.execute(
                "UPDATE inquiries SET created_at = now() - interval '200 days', predicted_label = %s, confidence = 0.95,"
                " status = 'awaiting_approval', rewrite_count = 0, resolved_at = NULL",
                (A,),
            )
            conn.execute("DELETE FROM action_logs")
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
        return ids[: len(rows)]

    def sql(self, statement, params=()):
        with self.connect() as conn:
            conn.execute(statement, params)
            conn.commit()

    def get(self, days=None):
        return self.login("kim").get("/api/stats/inquiries" + (f"?days={days}" if days else ""))

    # --- 날짜별 -----------------------------------------------------------------

    def test_counts_per_day_and_type(self):
        self.place([(0, "09:00", A), (0, "10:00", A), (0, "11:00", B), (1, "09:00", B), (3, "09:00", A)])
        body = self.get(7).json()
        self.assertEqual((body["days"], body["unit"], body["elapsed"]), (7, "day", 7))
        self.assertEqual(body["total"], 5)
        self.assertEqual(len(body["buckets"]), 7)
        by_ago = {7 - 1 - n: day for n, day in enumerate(body["buckets"])}  # 며칠 전 -> 그날
        self.assertEqual(by_ago[0]["total"], 3)
        self.assertEqual(by_ago[0]["counts"][A], 2)
        self.assertEqual(by_ago[0]["counts"][B], 1)
        self.assertEqual(by_ago[1]["counts"][B], 1)
        self.assertEqual(by_ago[2]["total"], 0)  # 문의가 없는 날도 0건으로 나온다
        self.assertEqual(by_ago[3]["counts"][A], 1)
        # 날짜는 오래된 날부터 오늘까지
        self.assertEqual([d["key"] for d in body["buckets"]], sorted(d["key"] for d in body["buckets"]))
        self.assertEqual(body["buckets"][-1]["key"], body["end"])
        self.assertEqual(body["buckets"][0]["key"], body["start"])

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
        for day in body["buckets"]:
            self.assertEqual(sorted(day["counts"]), sorted(LABELS))
            self.assertEqual(day["total"], sum(day["counts"].values()))

    def test_period_choices_cut_at_the_right_day(self):
        # 6일 전은 7일 안에 들어오고, 7일 전은 들어오지 않는다
        self.place([(0, "09:00", A), (6, "09:00", A), (7, "09:00", B), (13, "09:00", B), (14, "09:00", B), (29, "09:00", A), (30, "09:00", A)])
        self.assertEqual(self.get(1).json()["total"], 1)
        self.assertEqual(self.get(7).json()["total"], 2)
        self.assertEqual(self.get(14).json()["total"], 4)
        self.assertEqual(self.get(30).json()["total"], 6)
        self.assertEqual(len(self.get(30).json()["buckets"]), 30)

    def test_default_period_is_14_days(self):
        self.place([(13, "09:00", A), (14, "09:00", A)])
        body = self.get().json()
        self.assertEqual((body["days"], body["total"]), (14, 1))

    def test_day_is_counted_in_korean_time(self):
        # 한국 시간 00:30과 23:30은 같은 날 안의 서로 다른 시각이다 (UTC로 보면 날짜가 갈린다)
        self.place([(2, "00:30", A), (2, "23:30", B), (1, "00:05", A)])
        body = self.get(7).json()
        by_ago = {6 - n: day for n, day in enumerate(body["buckets"])}
        self.assertEqual(by_ago[2]["total"], 2)
        self.assertEqual(by_ago[1]["total"], 1)

    def test_inquiries_without_a_type_are_counted_as_unclassified(self):
        ids = self.place([(0, "09:00", A)])
        self.sql("UPDATE inquiries SET predicted_label = NULL, confidence = NULL WHERE id = %s", (ids[0],))
        body = self.get(7).json()
        codes = [t["code"] for t in body["types"]]
        self.assertEqual(codes, LABELS + [UNCLASSIFIED])
        self.assertEqual(body["types"][-1]["name"], "분류 없음")
        self.assertEqual(body["types"][-1]["count"], 1)
        self.assertEqual(body["buckets"][-1]["counts"][UNCLASSIFIED], 1)
        self.assertEqual(body["overall"]["low_confidence"], 1)  # 분류를 못 한 문의는 확신도가 낮은 쪽으로 센다

    def test_no_inquiries_gives_zero_and_no_percentages(self):
        self.place([])
        body = self.get(7).json()
        self.assertEqual(body["total"], 0)
        self.assertTrue(all(t["count"] == 0 and t["percent"] == 0.0 for t in body["types"]))
        self.assertTrue(all(d["total"] == 0 for d in body["buckets"]))
        # 문의가 없으면 비율을 말할 수 없다 (0%가 아니라 값 없음)
        self.assertIsNone(body["overall"]["uncovered_percent"])
        self.assertIsNone(body["overall"]["low_confidence_percent"])
        self.assertIsNone(body["handling"]["approve_percent"])
        self.assertIsNone(body["handling"]["median_minutes"])

    def test_bad_period_is_rejected(self):
        for days in ("5", "0", "-7", "365", "abc", "2"):
            response = self.login("kim").get(f"/api/stats/inquiries?days={days}")
            self.assertIn(response.status_code, (400, 422), days)
        self.assertEqual(self.get(8).status_code, 400)
        self.assertEqual(self.get(8).json()["detail"], BAD_DAYS_MESSAGE)
        self.assertEqual(DAY_CHOICES, (1, 7, 14, 30))

    def test_login_is_required(self):
        self.assertEqual(self.new_client().get("/api/stats/inquiries").status_code, 401)

    def test_every_agent_sees_the_same_numbers(self):
        self.place([(0, "09:00", A), (1, "09:00", B)])
        kim = self.login("kim").get("/api/stats/inquiries?days=7").json()
        park = self.login("park").get("/api/stats/inquiries?days=7").json()
        self.assertEqual(kim, park)

    # --- 오늘 (시간대별) ---------------------------------------------------------

    def test_today_is_counted_per_hour_in_korean_time(self):
        self.place([(0, "09:10", A), (0, "09:50", B), (0, "14:00", A), (0, "00:20", A), (0, "23:59", B), (1, "09:30", A)])
        body = self.get(1).json()
        self.assertEqual((body["days"], body["unit"], body["start"], body["start"] == body["end"]), (1, "hour", body["end"], True))
        self.assertEqual([b["key"] for b in body["buckets"]], [f"{h:02d}" for h in range(24)])
        self.assertEqual(body["buckets"][9]["label"], "9시")
        self.assertTrue(1 <= body["elapsed"] <= 24)  # 지금까지 지난 시간 수
        self.assertEqual(body["total"], 5)  # 어제 문의는 빠진다
        by_hour = {int(b["key"]): b for b in body["buckets"]}
        self.assertEqual(by_hour[9]["total"], 2)
        self.assertEqual(by_hour[9]["counts"][A], 1)
        self.assertEqual(by_hour[9]["counts"][B], 1)
        self.assertEqual(by_hour[0]["total"], 1)  # 00:20은 오늘 0시
        self.assertEqual(by_hour[23]["total"], 1)
        self.assertEqual(by_hour[14]["total"], 1)
        self.assertEqual(by_hour[10]["total"], 0)

    # --- 규정 문서에는 없음 비율 -----------------------------------------------------

    def test_uncovered_rate_counts_only_drafts_that_cited_no_clause(self):
        ids = self.place([(0, "09:00", A), (0, "10:00", A), (0, "11:00", B), (0, "12:00", B)])
        cited, none = '["RFD-04"]', "[]"
        self.sql("UPDATE drafts SET uncovered_note = NULL, cited_articles = %s::jsonb WHERE inquiry_id = ANY(%s)", (cited, ids))
        self.sql("UPDATE drafts SET cited_articles = %s::jsonb WHERE inquiry_id = %s", (none, ids[0]))  # 규정 문서 0개 -> 없음
        # 규정 문서를 참고했으면, 모델이 일부 없음 메모를 남겼어도 "규정 문서에는 없음"이 아니다
        self.sql("UPDATE drafts SET uncovered_note = '입금일은 규정 문서에 없습니다.' WHERE inquiry_id = %s", (ids[1],))
        self.sql("UPDATE drafts SET cited_articles = %s::jsonb, uncovered_note = '   ' WHERE inquiry_id = %s", (none, ids[2]))  # 메모가 비어도 0개면 없음
        body = self.get(7).json()
        self.assertEqual((body["overall"]["drafted"], body["overall"]["uncovered"], body["overall"]["uncovered_percent"]), (4, 2, 50.0))
        by_code = {t["code"]: t for t in body["types"]}
        self.assertEqual((by_code[A]["drafted"], by_code[A]["uncovered"], by_code[A]["uncovered_percent"]), (2, 1, 50.0))
        self.assertEqual((by_code[B]["uncovered"], by_code[B]["uncovered_percent"]), (1, 50.0))
        self.assertIsNone(by_code["buyer_payment"]["uncovered_percent"])  # 문의가 없는 종류는 값 없음
        self.assertEqual(body["buckets"][-1]["uncovered"], 2)

    def test_uncovered_rate_uses_the_latest_draft_and_skips_inquiries_without_a_draft(self):
        ids = self.place([(0, "09:00", A), (0, "10:00", A), (0, "11:00", A), (0, "12:00", A)])
        self.sql("UPDATE drafts SET uncovered_note = NULL, cited_articles = '[\"RFD-04\"]'::jsonb WHERE inquiry_id = ANY(%s)", (ids,))
        add_second = "INSERT INTO drafts (inquiry_id, draft_no, content, cited_articles) VALUES (%s, 2, '새 초안', %s::jsonb)"
        # ids[0]: 처음 초안은 규정 문서 0개, 재작성한 새 초안은 규정 문서를 참고함 -> 지금은 규정 문서에 답이 있다
        self.sql("UPDATE drafts SET cited_articles = '[]'::jsonb WHERE inquiry_id = %s", (ids[0],))
        self.sql(add_second, (ids[0], '["RFD-04"]'))
        # ids[1], ids[2]: 처음엔 규정 문서를 참고했는데 재작성하니 0개 -> 지금은 없음
        self.sql(add_second, (ids[1], "[]"))
        self.sql(add_second, (ids[2], "[]"))
        # ids[3]: 초안이 없다 -> 분모에서 빠진다
        self.sql("DELETE FROM drafts WHERE inquiry_id = %s", (ids[3],))
        o = self.get(7).json()["overall"]
        self.assertEqual((o["total"], o["drafted"], o["uncovered"], o["uncovered_percent"]), (4, 3, 2, 66.7))

    # --- 확신도 ----------------------------------------------------------------------

    def test_low_confidence_uses_the_current_threshold(self):
        ids = self.place([(0, "09:00", A), (0, "10:00", A), (0, "11:00", B), (0, "12:00", B)])
        for inquiry_id, confidence in zip(ids, (0.95, 0.70, 0.699, 0.40)):
            self.sql("UPDATE inquiries SET confidence = %s WHERE id = %s", (confidence, inquiry_id))
        self.set_threshold(70)
        body = self.get(7).json()
        self.assertEqual(body["threshold"], 70)
        self.assertEqual((body["overall"]["low_confidence"], body["overall"]["low_confidence_percent"]), (2, 50.0))  # 70%는 낮지 않다
        by_code = {t["code"]: t for t in body["types"]}
        self.assertEqual(by_code[A]["low_confidence"], 0)
        self.assertEqual(by_code[B]["low_confidence_percent"], 100.0)
        self.set_threshold(96)  # 기준값을 올리면 낮은 문의가 늘어난다
        body = self.get(7).json()
        self.assertEqual((body["threshold"], body["overall"]["low_confidence"]), (96, 4))
        self.set_threshold(70)

    # --- 처리 현황 -------------------------------------------------------------------

    def test_handling_status_resolution_rewrite_and_time(self):
        ids = self.place([(0, "09:00", A), (0, "09:10", A), (0, "09:20", A), (0, "09:30", A), (0, "09:40", B), (0, "09:50", B)])
        with self.connect() as conn:
            kim = conn.execute("SELECT id FROM agents WHERE username = 'kim'").fetchone()["id"]

        def resolve(inquiry_id, action, minutes, actions=None):
            self.sql(
                "UPDATE inquiries SET status = 'done', resolved_at = created_at + make_interval(mins => %s) WHERE id = %s",
                (minutes, inquiry_id),
            )
            for a in actions or [action]:
                self.sql("INSERT INTO action_logs (inquiry_id, agent_id, action) VALUES (%s, %s, %s)", (inquiry_id, kim, a))

        resolve(ids[0], "approve", 10)
        resolve(ids[1], "approve", 30)
        resolve(ids[2], "edit", 50)
        resolve(ids[3], "manual_write", 110, actions=["approve", "edit", "manual_write"])  # 마지막 처리 방법만 센다
        self.sql("UPDATE inquiries SET status = 'manual' WHERE id = %s", (ids[4],))
        self.sql("UPDATE inquiries SET rewrite_count = 1 WHERE id = ANY(%s)", ([ids[2], ids[4]],))
        # 재작성은 처리 완료로 만드는 행동이 아니다
        self.sql("INSERT INTO action_logs (inquiry_id, agent_id, action) VALUES (%s, %s, 'rewrite')", (ids[4], kim))

        h = self.get(7).json()["handling"]
        self.assertEqual(h["statuses"], {"awaiting_approval": 1, "manual": 1, "done": 4})
        self.assertEqual(h["done"], 4)
        self.assertEqual(h["resolution"], {"approve": 2, "edit": 1, "manual_write": 1})
        self.assertEqual(h["approve_percent"], 50.0)
        self.assertEqual((h["rewrite_count"], h["rewrite_percent"]), (2, 33.3))
        self.assertEqual(h["median_minutes"], 40.0)  # 10, 30, 50, 110의 중앙값
        self.assertEqual(h["average_minutes"], 50.0)

    def test_handling_with_nothing_resolved(self):
        self.place([(0, "09:00", A)])
        h = self.get(7).json()["handling"]
        self.assertEqual((h["done"], h["approve_percent"], h["median_minutes"], h["average_minutes"]), (0, None, None, None))
        self.assertEqual(h["statuses"]["awaiting_approval"], 1)

    def test_only_inquiries_in_the_period_are_part_of_the_handling_numbers(self):
        ids = self.place([(0, "09:00", A), (10, "09:00", A)])
        for inquiry_id in ids:
            self.sql("UPDATE inquiries SET status = 'done', resolved_at = created_at + interval '5 minutes' WHERE id = %s", (inquiry_id,))
        self.assertEqual(self.get(7).json()["handling"]["done"], 1)
        self.assertEqual(self.get(14).json()["handling"]["done"], 2)
