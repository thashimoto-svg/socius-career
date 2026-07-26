/**
 * Placeholder sample data for the UI prototype.
 *
 * TODO(firebase): replace these constants with queries once Firestore is
 * wired up. Sessions come from the `sessions` collection; episodes from
 * `episodes`, structured as STAR + 学び + 感情, keyed to the signed-in user.
 * See docs/specs/ui-notes.md for the ownership / structuring requirements.
 */

export type Session = {
  id: string;
  title: string;
  date: string;
  turns: number;
  episodes: number;
};

export type Star = { S: string; T: string; A: string; R: string };

export type Episode = {
  id: string;
  title: string;
  tag: string;
  emotion: string;
  star: Star;
  learn: string;
};

export const SESSIONS: Session[] = [
  { id: "s1", title: "部活を続けた理由の深掘り", date: "7/18", turns: 24, episodes: 1 },
  { id: "s2", title: "初めての自己分析(ガイド)", date: "7/15", turns: 18, episodes: 1 },
  { id: "s3", title: "アルバイトでの失敗経験", date: "7/12", turns: 9, episodes: 0 },
];

export const EPISODES: Episode[] = [
  {
    id: "e1",
    title: "怪我からの復帰でレギュラーを掴んだ",
    tag: "部活動",
    emotion: "悔しさ → 手応え",
    star: {
      S: "大学2年の春、靭帯を痛めて3ヶ月離脱。同期がレギュラーに定着していた",
      T: "秋の大会までに、走力に頼らないプレースタイルで戻ること",
      A: "毎朝30分、試合映像を見てポジショニングをノートに記録。復帰後は監督に週1で意見をもらいに行った",
      R: "秋大会で先発復帰。チーム内のポジショニング勉強会を任された",
    },
    learn: "手が動かない期間でも、頭を使う準備はできる。焦りを分解すれば行動に変えられる",
  },
  {
    id: "e2",
    title: "文化祭の模擬店で赤字を立て直した",
    tag: "課外活動",
    emotion: "不安 → 達成感",
    star: {
      S: "2日間の文化祭、初日終了時点で売上が目標の4割だった",
      T: "2日目で損益分岐点を超えること",
      A: "初日の売れ残りから価格とメニュー数を半分に絞り、呼び込み担当を入口に集中させた",
      R: "2日目は初日の2.3倍を売り上げ、最終的に黒字で着地",
    },
    learn: "選択肢を減らす判断が、忙しい場面ほど効く",
  },
];
