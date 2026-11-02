"""Phase 3 시험: 위험 표현 찾기 (DB 없이 돈다)."""
import unittest

from app.risk import find_risks, normalize, split_sentences
from app.seed import read_seed_phrases

PHRASES = ["보상해 드", "전액 보상", "판정 바꿔", "무조건"]


class SplitTest(unittest.TestCase):
    def test_splits_on_sentence_marks_and_newlines(self):
        self.assertEqual(
            split_sentences("안녕하세요. 확인했습니다!\n감사합니다"),
            ["안녕하세요.", "확인했습니다!", "감사합니다"],
        )

    def test_empty(self):
        self.assertEqual(split_sentences(""), [])
        self.assertEqual(split_sentences(None), [])


class FindRisksTest(unittest.TestCase):
    def test_finds_the_sentence_and_the_phrase(self):
        found = find_risks("안녕하세요, 고객님. 보상해 드릴게요. 감사합니다.", PHRASES)
        self.assertEqual(found, [{"sentence": "보상해 드릴게요.", "phrases": ["보상해 드"]}])

    def test_spacing_is_ignored(self):
        self.assertEqual(len(find_risks("보상해드리겠습니다", PHRASES)), 1)
        self.assertEqual(len(find_risks("판정바꿔 드릴게요", PHRASES)), 1)
        self.assertEqual(len(find_risks("전 액 보 상 합니다", PHRASES)), 1)

    def test_one_sentence_can_hit_several_phrases(self):
        found = find_risks("무조건 전액 보상해 드리겠습니다.", PHRASES)
        self.assertEqual(len(found), 1)
        self.assertEqual(set(found[0]["phrases"]), {"무조건", "전액 보상", "보상해 드"})

    def test_several_sentences(self):
        found = find_risks("무조건 됩니다. 중간 문장입니다. 판정 바꿔 드릴게요.", PHRASES)
        self.assertEqual([f["sentence"] for f in found], ["무조건 됩니다.", "판정 바꿔 드릴게요."])

    def test_clean_text_and_empty(self):
        self.assertEqual(find_risks("확인 후 안내드리겠습니다. 감사합니다.", PHRASES), [])
        self.assertEqual(find_risks("", PHRASES), [])
        self.assertEqual(find_risks(None, PHRASES), [])
        self.assertEqual(find_risks("보상해 드릴게요", []), [])

    def test_blank_phrases_are_ignored(self):
        self.assertEqual(find_risks("아무 말이나 합니다", ["", "  "]), [])

    def test_normalize(self):
        self.assertEqual(normalize(" 보상해 \n드 "), "보상해드")


class SeedPhrasesTest(unittest.TestCase):
    def test_20_phrases_without_duplicates(self):
        phrases = read_seed_phrases()
        self.assertEqual(len(phrases), 20)
        self.assertEqual(len({normalize(p) for p in phrases}), 20)

    def test_the_examples_from_the_spec_are_caught(self):
        phrases = read_seed_phrases()
        for sentence in ("보상해 드릴게요", "판정 바꿔 드릴게요", "판정을 바꿔 드리겠습니다", "페널티는 면제해 드리겠습니다"):
            self.assertTrue(find_risks(sentence, phrases), sentence)

    def test_normal_guidance_is_not_flagged(self):
        phrases = read_seed_phrases()
        for sentence in (
            "확인 후 안내드리겠습니다.",
            "영업일 기준 3일 이내에 입금됩니다.",
            "소명 절차는 일대일 문의에서 진행하실 수 있습니다.",
        ):
            self.assertEqual(find_risks(sentence, phrases), [], sentence)


if __name__ == "__main__":
    unittest.main()
