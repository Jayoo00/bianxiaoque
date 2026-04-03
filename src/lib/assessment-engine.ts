import { generateQwenNarrative } from "@/lib/qwen";
import { getBirthTimingProfile, getSeasonalContext } from "@/lib/seasonal-context";
import type {
  AnswerStore,
  AnswerValue,
  AssessmentResult,
  BirthTimingProfile,
  ConstitutionId,
  NarrativeBlocks,
  QuestionOption,
  QuestionPayload,
  QuestionType,
  SeasonalContext,
  TurnResponse,
} from "@/lib/types";

type ConstitutionMeta = {
  label: string;
  description: string;
};

type WeightedSignal = {
  value: number;
  weight: number;
  text?: string;
};

type ConstitutionState = {
  questionSignals: WeightedSignal[];
  contextSignals: WeightedSignal[];
};

type OptionEffect = {
  constitutionId: ConstitutionId;
  value: number;
  text?: string;
  weight?: number;
};

type QuestionDefinition = {
  id: string;
  prompt: string;
  description?: string;
  type: QuestionType;
  options: QuestionOption[];
  maxSelections?: number;
  source?: string;
  minDate?: string;
  maxDate?: string;
  targets?: ConstitutionId[];
  signals?: Array<{
    constitutionId: ConstitutionId;
    polarity: 1 | -1;
    text: string;
    weight?: number;
  }>;
  bonusTags?: string[];
};

type RecommendationDefinition = {
  id: string;
  name: string;
  benefit: string;
  constitutionWeights: Partial<Record<ConstitutionId, number>>;
  tagWeights: Record<string, number>;
};

const QUESTION_LIMIT = 11;
const DISPLAY_QUESTION_LIMIT = 9;
const PRELUDE_QUESTION_IDS = new Set(["gender", "birthDate"]);

const CONSTITUTION_META: Record<ConstitutionId, ConstitutionMeta> = {
  balanced: {
    label: "平和偏稳",
    description: "整体适应力相对不错，适合以维稳和顺时养护为主。",
  },
  qiDeficiency: {
    label: "气虚质",
    description: "更容易出现疲乏、气短、恢复慢，调养重点在补气和稳住节律。",
  },
  yangDeficiency: {
    label: "阳虚质",
    description: "偏向怕冷、手足不温，调养重点在护阳和改善畏寒乏力。",
  },
  yinDeficiency: {
    label: "阴虚质",
    description: "偏向口干、心烦、手足心热，调养重点在护津和缓解虚烦。",
  },
  phlegmDamp: {
    label: "痰湿质",
    description: "偏向困重、口黏、腹部松软，调养重点在健脾化湿和减轻滞感。",
  },
  dampHeat: {
    label: "湿热质",
    description: "偏向油腻、口苦或尿黄，调养重点在清利湿热和减轻郁热。",
  },
  bloodStasis: {
    label: "血瘀质",
    description: "偏向固定痛或色泽偏暗，调养重点在舒展气血、减少久滞。",
  },
  qiStagnation: {
    label: "气郁质",
    description: "偏向情绪低沉、紧张或胸胁不舒，调养重点在疏肝理气、放松节律。",
  },
  specialDiathesis: {
    label: "特禀质",
    description: "偏向易敏感、喷嚏或鼻咽反复，调养重点在避敏和稳住正气。",
  },
};

const LIKERT_OPTIONS: QuestionOption[] = [
  { id: "1", label: "根本不" },
  { id: "2", label: "有一点" },
  { id: "3", label: "有些" },
  { id: "4", label: "相当" },
  { id: "5", label: "非常" },
];

const ONBOARDING_QUESTIONS: QuestionDefinition[] = [
  {
    id: "gender",
    prompt: "先确认一下，您的性别是？",
    description: "仅用于让问答更贴近您，不会单独展示。",
    type: "single",
    options: [
      { id: "female", label: "女" },
      { id: "male", label: "男" },
      { id: "prefer_not", label: "不特别区分" },
    ],
  },
  {
    id: "birthDate",
    prompt: "再记一下您的出生年月日。",
    description: "用于结合个人五运六气节律做参考，不会采集存储您的隐私信息。",
    type: "date",
    options: [],
    minDate: "1900-01-01",
  },
  {
    id: "mainSignals",
    prompt: "最近最想改善的状态，选 1-3 项最像您的。",
    description: "我会根据这些答案动态收窄后面的题目。",
    type: "multi",
    maxSelections: 3,
    options: [
      { id: "energy_low", label: "容易累，稍动就乏" },
      { id: "cold_sensitivity", label: "怕冷，手脚偏凉" },
      { id: "dry_heat", label: "口干，心烦或手足心热" },
      { id: "damp_heavy", label: "身体发沉，口黏或腹部松软" },
      { id: "oily_irritable", label: "出油明显，口苦尿黄或易烦" },
      { id: "low_mood", label: "郁闷焦虑，胸口像有点堵" },
      { id: "pain_dark", label: "有固定痛点，或脸色唇色偏暗" },
      { id: "allergy", label: "容易喷嚏、过敏或皮肤敏感" },
      { id: "stable", label: "整体还算稳，只想做日常调养" },
    ],
  },
  {
    id: "habits",
    prompt: "再补一个生活习惯问题，选 1-3 项最接近现在的您。",
    type: "multi",
    maxSelections: 3,
    options: [
      { id: "late_sleep", label: "经常熬夜，或睡得不够沉" },
      { id: "sedentary", label: "久坐少动，肩颈腰背容易僵" },
      { id: "stress_high", label: "压力偏大，脑子停不下来" },
      { id: "heavy_diet", label: "常吃辛辣、油炸、甜饮或夜宵" },
      { id: "exercise_regular", label: "运动还算规律" },
      { id: "commuting_crowds", label: "通勤、人群或空调环境比较多" },
    ],
  },
];

const TARGETED_QUESTIONS: QuestionDefinition[] = [
  {
    id: "fatigue",
    prompt: "最近一年里，您容易疲乏吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["qiDeficiency", "balanced"],
    signals: [
      { constitutionId: "qiDeficiency", polarity: 1, text: "容易疲乏", weight: 1.1 },
      { constitutionId: "balanced", polarity: -1, text: "精力相对稳定", weight: 0.9 },
    ],
    bonusTags: ["energy_low"],
  },
  {
    id: "shortBreath",
    prompt: "您容易气短，或者活动后接不上气吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["qiDeficiency"],
    signals: [{ constitutionId: "qiDeficiency", polarity: 1, text: "容易气短" }],
    bonusTags: ["energy_low"],
  },
  {
    id: "coldTolerance",
    prompt: "您比一般人更不耐冷吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["yangDeficiency", "balanced"],
    signals: [
      { constitutionId: "yangDeficiency", polarity: 1, text: "不耐寒冷", weight: 1.1 },
      { constitutionId: "balanced", polarity: -1, text: "寒热耐受度尚可", weight: 0.8 },
    ],
    bonusTags: ["cold_sensitivity", "commuting_crowds"],
  },
  {
    id: "coldBack",
    prompt: "您胃脘、背部或腰膝部容易发冷吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["yangDeficiency"],
    signals: [{ constitutionId: "yangDeficiency", polarity: 1, text: "腰背或胃脘偏冷" }],
    bonusTags: ["cold_sensitivity"],
  },
  {
    id: "bodyHeat",
    prompt: "您会感觉身体或脸上发热吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["yinDeficiency"],
    signals: [{ constitutionId: "yinDeficiency", polarity: 1, text: "有发热或虚烦感" }],
    bonusTags: ["dry_heat", "late_sleep"],
  },
  {
    id: "dryness",
    prompt: "您会觉得皮肤或口唇偏干吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["yinDeficiency"],
    signals: [{ constitutionId: "yinDeficiency", polarity: 1, text: "口唇或皮肤偏干" }],
    bonusTags: ["dry_heat", "late_sleep"],
  },
  {
    id: "heaviness",
    prompt: "您常有身体发沉、不轻松的感觉吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["phlegmDamp"],
    signals: [{ constitutionId: "phlegmDamp", polarity: 1, text: "身体困重" }],
    bonusTags: ["damp_heavy", "sedentary", "heavy_diet"],
  },
  {
    id: "stickyMouth",
    prompt: "您嘴里会有黏黏的感觉吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["phlegmDamp"],
    signals: [{ constitutionId: "phlegmDamp", polarity: 1, text: "口中黏腻" }],
    bonusTags: ["damp_heavy", "heavy_diet"],
  },
  {
    id: "oilyFace",
    prompt: "您面部或鼻部会明显油腻发亮吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["dampHeat"],
    signals: [{ constitutionId: "dampHeat", polarity: 1, text: "面部油腻明显" }],
    bonusTags: ["oily_irritable", "heavy_diet"],
  },
  {
    id: "darkUrine",
    prompt: "您小便颜色偏深，或容易有热感吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["dampHeat"],
    signals: [{ constitutionId: "dampHeat", polarity: 1, text: "尿色偏深或有热感" }],
    bonusTags: ["oily_irritable", "heavy_diet"],
  },
  {
    id: "lowMoodQuestion",
    prompt: "您会经常闷闷不乐、情绪低沉吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["qiStagnation", "balanced"],
    signals: [
      { constitutionId: "qiStagnation", polarity: 1, text: "情绪偏郁" },
      { constitutionId: "balanced", polarity: -1, text: "情绪总体平稳", weight: 0.7 },
    ],
    bonusTags: ["low_mood", "stress_high"],
  },
  {
    id: "anxiety",
    prompt: "您容易精神紧张、焦虑不安吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["qiStagnation"],
    signals: [{ constitutionId: "qiStagnation", polarity: 1, text: "紧张焦虑感明显" }],
    bonusTags: ["low_mood", "stress_high"],
  },
  {
    id: "fixedPain",
    prompt: "您身体某个部位会出现比较固定的疼痛吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["bloodStasis"],
    signals: [{ constitutionId: "bloodStasis", polarity: 1, text: "有固定痛点" }],
    bonusTags: ["pain_dark", "sedentary"],
  },
  {
    id: "darkComplexion",
    prompt: "您会觉得面色偏晦暗，或者容易出现褐斑吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["bloodStasis"],
    signals: [{ constitutionId: "bloodStasis", polarity: 1, text: "面色或色泽偏暗" }],
    bonusTags: ["pain_dark"],
  },
  {
    id: "sneeze",
    prompt: "没有感冒时，您也会容易打喷嚏吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["specialDiathesis"],
    signals: [{ constitutionId: "specialDiathesis", polarity: 1, text: "平时也容易喷嚏" }],
    bonusTags: ["allergy", "commuting_crowds"],
  },
  {
    id: "allergyQuestion",
    prompt: "您容易对食物、气味、花粉或换季过敏吗？",
    type: "single",
    options: LIKERT_OPTIONS,
    source: "参考 GB/T 46939—2025 附录A",
    targets: ["specialDiathesis"],
    signals: [{ constitutionId: "specialDiathesis", polarity: 1, text: "过敏倾向明显" }],
    bonusTags: ["allergy", "commuting_crowds"],
  },
];

const QUESTION_MAP = [...ONBOARDING_QUESTIONS, ...TARGETED_QUESTIONS].reduce<
  Record<string, QuestionDefinition>
>((accumulator, question) => {
  accumulator[question.id] = question;
  return accumulator;
}, {});

const CONCERN_EFFECTS: Record<string, OptionEffect[]> = {
  energy_low: [
    { constitutionId: "qiDeficiency", value: 78, text: "容易疲乏", weight: 1.1 },
    { constitutionId: "yangDeficiency", value: 52, text: "乏力偏重", weight: 0.7 },
  ],
  cold_sensitivity: [
    { constitutionId: "yangDeficiency", value: 82, text: "怕冷手脚凉", weight: 1.1 },
    { constitutionId: "qiDeficiency", value: 48, text: "畏冷伴乏力", weight: 0.6 },
  ],
  dry_heat: [
    { constitutionId: "yinDeficiency", value: 80, text: "口干或虚烦", weight: 1.1 },
    { constitutionId: "dampHeat", value: 40, text: "有热象", weight: 0.4 },
  ],
  damp_heavy: [
    { constitutionId: "phlegmDamp", value: 84, text: "身体困重或口黏", weight: 1.1 },
    { constitutionId: "dampHeat", value: 60, text: "湿滞偏重", weight: 0.8 },
  ],
  oily_irritable: [
    { constitutionId: "dampHeat", value: 84, text: "油腻口苦或尿黄", weight: 1.1 },
    { constitutionId: "phlegmDamp", value: 46, text: "湿浊偏重", weight: 0.5 },
  ],
  low_mood: [
    { constitutionId: "qiStagnation", value: 84, text: "情绪郁闷或胸口发堵", weight: 1.1 },
    { constitutionId: "yinDeficiency", value: 34, text: "伴有虚烦倾向", weight: 0.4 },
  ],
  pain_dark: [
    { constitutionId: "bloodStasis", value: 86, text: "固定痛或色泽偏暗", weight: 1.1 },
    { constitutionId: "qiStagnation", value: 36, text: "气机不畅", weight: 0.4 },
  ],
  allergy: [{ constitutionId: "specialDiathesis", value: 88, text: "易过敏或鼻咽敏感", weight: 1.1 }],
  stable: [{ constitutionId: "balanced", value: 88, text: "整体状态较稳", weight: 1.1 }],
};

const HABIT_EFFECTS: Record<string, OptionEffect[]> = {
  late_sleep: [
    { constitutionId: "yinDeficiency", value: 68, text: "作息偏晚", weight: 1 },
    { constitutionId: "qiStagnation", value: 52, text: "晚睡易郁滞", weight: 0.7 },
    { constitutionId: "dampHeat", value: 44, text: "熬夜易生郁热", weight: 0.5 },
    { constitutionId: "balanced", value: 30, weight: 0.8 },
  ],
  sedentary: [
    { constitutionId: "phlegmDamp", value: 60, text: "久坐少动", weight: 0.9 },
    { constitutionId: "qiStagnation", value: 48, text: "久坐气机不展", weight: 0.7 },
    { constitutionId: "bloodStasis", value: 40, text: "久滞影响气血", weight: 0.5 },
    { constitutionId: "balanced", value: 34, weight: 0.7 },
  ],
  stress_high: [
    { constitutionId: "qiStagnation", value: 74, text: "压力偏大", weight: 1 },
    { constitutionId: "yinDeficiency", value: 46, text: "压力易化热", weight: 0.6 },
    { constitutionId: "balanced", value: 28, weight: 0.9 },
  ],
  heavy_diet: [
    { constitutionId: "dampHeat", value: 70, text: "饮食偏重", weight: 1 },
    { constitutionId: "phlegmDamp", value: 64, text: "肥甘厚味偏多", weight: 0.9 },
    { constitutionId: "balanced", value: 32, weight: 0.8 },
  ],
  exercise_regular: [{ constitutionId: "balanced", value: 84, text: "运动比较规律", weight: 1 }],
  commuting_crowds: [
    { constitutionId: "specialDiathesis", value: 58, text: "通勤与人群环境较多", weight: 0.8 },
    { constitutionId: "qiDeficiency", value: 42, text: "耗气场景偏多", weight: 0.5 },
    { constitutionId: "yangDeficiency", value: 34, text: "空调环境偏多", weight: 0.4 },
  ],
};

const HABIT_LABELS: Record<string, string> = {
  late_sleep: "作息偏晚",
  sedentary: "久坐少动",
  stress_high: "压力偏大",
  heavy_diet: "饮食偏重",
  exercise_regular: "运动比较规律",
  commuting_crowds: "通勤与空调环境较多",
};

const BIRTH_TAG_EFFECTS: Record<string, OptionEffect[]> = {
  fire: [
    { constitutionId: "yinDeficiency", value: 58, text: "个人节律偏火", weight: 0.4 },
    { constitutionId: "dampHeat", value: 50, text: "火热倾向偏显", weight: 0.3 },
  ],
  dry: [
    { constitutionId: "yinDeficiency", value: 60, text: "个人节律偏燥", weight: 0.4 },
    { constitutionId: "specialDiathesis", value: 48, text: "燥敏倾向偏显", weight: 0.3 },
  ],
  damp: [
    { constitutionId: "phlegmDamp", value: 60, text: "个人节律偏湿", weight: 0.4 },
    { constitutionId: "dampHeat", value: 52, text: "湿滞倾向偏显", weight: 0.3 },
  ],
  cold: [
    { constitutionId: "yangDeficiency", value: 60, text: "个人节律偏寒", weight: 0.4 },
    { constitutionId: "qiDeficiency", value: 48, text: "阳气推动偏弱", weight: 0.3 },
  ],
  wind: [
    { constitutionId: "qiStagnation", value: 52, text: "气机升降偏敏", weight: 0.35 },
    { constitutionId: "specialDiathesis", value: 46, text: "外界刺激感受偏敏", weight: 0.25 },
  ],
  autumn: [{ constitutionId: "specialDiathesis", value: 46, text: "咽鼻津液更需顾护", weight: 0.2 }],
  winter: [{ constitutionId: "yangDeficiency", value: 48, text: "护阳需求更明显", weight: 0.2 }],
};

const POTENTIAL_FOCUS: Record<ConstitutionId, string[]> = {
  balanced: ["作息节律", "脾胃运化", "情绪与睡眠稳定度"],
  qiDeficiency: ["体力恢复", "呼吸耐力", "易疲乏时的恢复速度"],
  yangDeficiency: ["畏寒与手足温度", "腰背与下肢发冷感", "清晨状态与恢复力"],
  yinDeficiency: ["睡眠与虚烦", "口咽皮肤干燥感", "久热、熬夜后的津液消耗"],
  phlegmDamp: ["脾胃运化", "身体困重感", "饮食偏重后的负担感"],
  dampHeat: ["口苦油腻与热感", "脾胃湿热负担", "熬夜辛辣后的上火感"],
  bloodStasis: ["固定痛感", "久坐后的气血不畅", "色泽偏暗或循环滞感"],
  qiStagnation: ["情绪压力", "胸胁肩颈紧绷", "睡眠与放松节律"],
  specialDiathesis: ["鼻咽与皮肤敏感", "换季与人群环境刺激", "外界气味或花粉反应"],
};

const TAG_REASON_MAP: Record<string, string> = {
  energy_low: "适合疲乏感较明显时",
  cold_sensitivity: "更照顾怕冷和手脚偏凉",
  dry_heat: "更贴近口干心烦一类感受",
  damp_heavy: "对困重、口黏一类状态更友好",
  oily_irritable: "兼顾油腻、口苦或郁热感",
  low_mood: "更适合情绪郁滞时",
  pain_dark: "适合固定痛或气血不畅时",
  allergy: "兼顾鼻咽和易敏感场景",
  stable: "适合做日常维稳调养",
  late_sleep: "针对熬夜后的恢复压力",
  sedentary: "适合久坐后气机不展时",
  stress_high: "适合压力大、绷得紧的时候",
  heavy_diet: "适合饮食偏重后的脾胃负担",
  exercise_regular: "也适合做稳定维持",
  commuting_crowds: "兼顾通勤和外界刺激较多的场景",
  wind: "兼顾春季风气升发",
  fire: "顺着当前到下一阶段火气渐显",
  "summer-prep": "提前为入夏做缓冲",
  damp: "顺着湿气偏重的调养重点",
  dry: "兼顾燥气渐起时的护津需求",
  cold: "兼顾护阳",
  "spring-rise": "顺着春季升发节律",
};

const BADUANJIN_RECOMMENDATIONS: RecommendationDefinition[] = [
  {
    id: "lift-sky",
    name: "两手托天理三焦",
    benefit: "帮助舒展胸胁、理顺上中下三焦的气机。",
    constitutionWeights: {
      qiStagnation: 16,
      dampHeat: 8,
      balanced: 6,
    },
    tagWeights: {
      stress_high: 8,
      low_mood: 8,
      "spring-rise": 7,
      fire: 5,
      sedentary: 4,
    },
  },
  {
    id: "draw-bow",
    name: "左右开弓似射雕",
    benefit: "帮助开胸理肺、提振呼吸与专注感。",
    constitutionWeights: {
      qiDeficiency: 14,
      specialDiathesis: 12,
      bloodStasis: 8,
    },
    tagWeights: {
      allergy: 8,
      commuting_crowds: 6,
      wind: 6,
      energy_low: 5,
    },
  },
  {
    id: "lift-single-arm",
    name: "调理脾胃须单举",
    benefit: "更偏向健脾和中，帮助减轻饮食积滞和困重感。",
    constitutionWeights: {
      phlegmDamp: 18,
      dampHeat: 12,
      qiDeficiency: 6,
    },
    tagWeights: {
      damp_heavy: 9,
      heavy_diet: 9,
      damp: 8,
      sedentary: 6,
    },
  },
  {
    id: "look-back",
    name: "五劳七伤往后瞧",
    benefit: "更适合缓解肩颈紧绷、心烦与久坐后的上焦郁滞。",
    constitutionWeights: {
      qiStagnation: 14,
      yinDeficiency: 10,
      balanced: 4,
    },
    tagWeights: {
      stress_high: 8,
      late_sleep: 7,
      fire: 8,
      sedentary: 6,
    },
  },
  {
    id: "shake-head",
    name: "摇头摆尾去心火",
    benefit: "更偏向清解虚烦、松开胸腰并缓和郁热感。",
    constitutionWeights: {
      yinDeficiency: 16,
      dampHeat: 14,
      qiStagnation: 8,
    },
    tagWeights: {
      dry_heat: 9,
      oily_irritable: 8,
      late_sleep: 8,
      fire: 10,
      "summer-prep": 5,
    },
  },
  {
    id: "touch-feet",
    name: "两手攀足固肾腰",
    benefit: "帮助温养腰肾，适合改善畏寒、腰背发冷与恢复慢。",
    constitutionWeights: {
      yangDeficiency: 20,
      qiDeficiency: 10,
    },
    tagWeights: {
      cold_sensitivity: 10,
      cold: 8,
      sedentary: 5,
      energy_low: 5,
    },
  },
  {
    id: "clench-fists",
    name: "攒拳怒目增气力",
    benefit: "更适合提振气力、带动全身气血运行。",
    constitutionWeights: {
      qiDeficiency: 16,
      bloodStasis: 10,
      balanced: 4,
    },
    tagWeights: {
      energy_low: 8,
      sedentary: 5,
      stable: 4,
    },
  },
  {
    id: "rise-heels",
    name: "背后七颠百病消",
    benefit: "以轻震带动气血和脾胃运化，适合做收尾巩固。",
    constitutionWeights: {
      phlegmDamp: 10,
      balanced: 10,
      qiDeficiency: 8,
    },
    tagWeights: {
      damp_heavy: 6,
      exercise_regular: 6,
      stable: 6,
      damp: 5,
    },
  },
];

const SACHET_RECOMMENDATIONS: RecommendationDefinition[] = [
  {
    id: "calm-spirit",
    name: "安神香囊",
    benefit: "更偏向安神镇定、静心助眠，适合收敛虚烦和情绪波动。",
    constitutionWeights: {
      qiStagnation: 14,
      yinDeficiency: 14,
      balanced: 6,
    },
    tagWeights: {
      late_sleep: 10,
      stress_high: 10,
      low_mood: 8,
      dry_heat: 6,
      fire: 7,
    },
  },
  {
    id: "smooth-qi",
    name: "顺气香囊",
    benefit: "更偏向疏肝理气、顺心解郁，适合胸口发堵、情绪绷紧时。",
    constitutionWeights: {
      qiStagnation: 20,
      bloodStasis: 8,
    },
    tagWeights: {
      stress_high: 10,
      low_mood: 10,
      "spring-rise": 8,
      pain_dark: 5,
    },
  },
  {
    id: "refresh-spirit",
    name: "醒神香囊",
    benefit: "更偏向醒神通窍、提神化浊，适合春困、困重和头面不清爽时。",
    constitutionWeights: {
      phlegmDamp: 16,
      dampHeat: 14,
      qiDeficiency: 8,
    },
    tagWeights: {
      damp_heavy: 8,
      oily_irritable: 8,
      sedentary: 5,
      commuting_crowds: 5,
      "spring-rise": 6,
      damp: 6,
    },
  },
  {
    id: "upright-qi",
    name: "正气香囊",
    benefit: "更偏向避疫防感、祛湿驱蚊，适合通勤、人群和易敏感场景。",
    constitutionWeights: {
      specialDiathesis: 18,
      qiDeficiency: 10,
      yangDeficiency: 8,
      phlegmDamp: 8,
    },
    tagWeights: {
      allergy: 10,
      commuting_crowds: 10,
      damp: 8,
      wind: 7,
      cold: 5,
    },
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function weightedAverage(entries: WeightedSignal[]) {
  if (entries.length === 0) {
    return undefined;
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);

  if (totalWeight === 0) {
    return undefined;
  }

  const weightedSum = entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0);
  return weightedSum / totalWeight;
}

function makeEmptyState() {
  return Object.keys(CONSTITUTION_META).reduce<Record<ConstitutionId, ConstitutionState>>((accumulator, key) => {
    accumulator[key as ConstitutionId] = {
      questionSignals: [],
      contextSignals: [],
    };
    return accumulator;
  }, {} as Record<ConstitutionId, ConstitutionState>);
}

function asArray(value: AnswerValue | undefined) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
}

function getTodayDateString() {
  const today = new Date();

  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function normalizeAnswers(raw: unknown): AnswerStore {
  const normalized: AnswerStore = {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return normalized;
  }

  const source = raw as Record<string, unknown>;

  for (const [questionId, definition] of Object.entries(QUESTION_MAP)) {
    const incoming = source[questionId];

    if (definition.type === "multi") {
      if (!Array.isArray(incoming)) {
        continue;
      }

      const allowed = new Set(definition.options.map((option) => option.id));
      const maxSelections = definition.maxSelections ?? definition.options.length;
      const values = incoming
        .filter((item): item is string => typeof item === "string" && allowed.has(item))
        .slice(0, maxSelections);

      if (values.length > 0) {
        normalized[questionId] = Array.from(new Set(values));
      }

      continue;
    }

    if (definition.type === "date") {
      const maxDate = definition.maxDate ?? getTodayDateString();

      if (
        typeof incoming === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(incoming) &&
        (!definition.minDate || incoming >= definition.minDate) &&
        incoming <= maxDate
      ) {
        normalized[questionId] = incoming;
      }

      continue;
    }

    if (typeof incoming !== "string") {
      continue;
    }

    if (definition.options.some((option) => option.id === incoming)) {
      normalized[questionId] = incoming;
    }
  }

  return normalized;
}

function addSignal(
  state: Record<ConstitutionId, ConstitutionState>,
  constitutionId: ConstitutionId,
  bucket: "contextSignals" | "questionSignals",
  value: number,
  text?: string,
  weight = 1,
) {
  state[constitutionId][bucket].push({
    value: clamp(value, 0, 100),
    text: text && value >= 60 ? text : undefined,
    weight,
  });
}

function likertToSignal(answerId: string, polarity: 1 | -1) {
  const numeric = Number(answerId);
  const normalized = clamp((numeric - 1) / 4, 0, 1) * 100;
  return polarity === 1 ? normalized : 100 - normalized;
}

function scoreAnswers(answers: AnswerStore) {
  const state = makeEmptyState();
  const selectedTags = new Set<string>();
  const birthTimingProfile = typeof answers.birthDate === "string" ? getBirthTimingProfile(answers.birthDate) : undefined;

  for (const tag of birthTimingProfile?.tags ?? []) {
    selectedTags.add(tag);

    for (const effect of BIRTH_TAG_EFFECTS[tag] ?? []) {
      addSignal(
        state,
        effect.constitutionId,
        "contextSignals",
        effect.value,
        effect.text,
        effect.weight ?? 1,
      );
    }
  }

  for (const selectedId of asArray(answers.mainSignals)) {
    selectedTags.add(selectedId);

    for (const effect of CONCERN_EFFECTS[selectedId] ?? []) {
      addSignal(
        state,
        effect.constitutionId,
        "contextSignals",
        effect.value,
        effect.text,
        effect.weight ?? 1,
      );
    }
  }

  for (const selectedId of asArray(answers.habits)) {
    selectedTags.add(selectedId);

    for (const effect of HABIT_EFFECTS[selectedId] ?? []) {
      addSignal(
        state,
        effect.constitutionId,
        "contextSignals",
        effect.value,
        effect.text,
        effect.weight ?? 1,
      );
    }
  }

  for (const question of TARGETED_QUESTIONS) {
    const answer = answers[question.id];

    if (typeof answer !== "string" || !question.signals) {
      continue;
    }

    for (const signal of question.signals) {
      addSignal(
        state,
        signal.constitutionId,
        "questionSignals",
        likertToSignal(answer, signal.polarity),
        signal.text,
        signal.weight ?? 1,
      );
    }
  }

  const scores = (Object.keys(CONSTITUTION_META) as ConstitutionId[]).map((constitutionId) => {
    const constitutionState = state[constitutionId];
    const questionAverage = weightedAverage(constitutionState.questionSignals);
    const contextAverage = weightedAverage(constitutionState.contextSignals);
    const base = constitutionId === "balanced" ? 42 : 18;

    let score = base;

    if (questionAverage !== undefined && contextAverage !== undefined) {
      score = questionAverage * 0.68 + contextAverage * 0.24 + base * 0.08;
    } else if (questionAverage !== undefined) {
      score = questionAverage * 0.78 + base * 0.22;
    } else if (contextAverage !== undefined) {
      score = contextAverage * 0.75 + base * 0.25;
    }

    if (questionAverage !== undefined && constitutionState.questionSignals.length >= 2) {
      score += 2;
    }

    return {
      id: constitutionId,
      score: clamp(Math.round(score), 0, 100),
      reasons: [...constitutionState.questionSignals, ...constitutionState.contextSignals]
        .filter((entry): entry is WeightedSignal & { text: string } => Boolean(entry.text))
        .sort((left, right) => right.value * right.weight - left.value * left.weight)
        .map((entry) => entry.text)
        .filter((text, index, array) => array.indexOf(text) === index)
        .slice(0, 3),
      questionCount: constitutionState.questionSignals.length,
      contextCount: constitutionState.contextSignals.length,
    };
  });

  return {
    scores,
    selectedTags,
    birthTimingProfile,
  };
}

function targetedCoverage(answers: AnswerStore) {
  const coverage = Object.keys(CONSTITUTION_META).reduce<Record<ConstitutionId, number>>((accumulator, key) => {
    accumulator[key as ConstitutionId] = 0;
    return accumulator;
  }, {} as Record<ConstitutionId, number>);

  for (const question of TARGETED_QUESTIONS) {
    if (!(question.id in answers)) {
      continue;
    }

    for (const target of question.targets ?? []) {
      coverage[target] += 1;
    }
  }

  return coverage;
}

function getNextQuestion(answers: AnswerStore): QuestionPayload | null {
  for (const onboardingQuestion of ONBOARDING_QUESTIONS) {
    if (!(onboardingQuestion.id in answers)) {
      return serializeQuestion(onboardingQuestion);
    }
  }

  const targetedAsked = TARGETED_QUESTIONS.filter((question) => question.id in answers).length;
  const { scores, selectedTags } = scoreAnswers(answers);
  const coverage = targetedCoverage(answers);
  const topBiased = scores
    .filter((item) => item.id !== "balanced")
    .sort((left, right) => right.score - left.score);

  if (targetedAsked >= QUESTION_LIMIT - ONBOARDING_QUESTIONS.length) {
    return null;
  }

  const candidateRanks = new Map<ConstitutionId, number>();

  topBiased.slice(0, 4).forEach((item, index) => {
    candidateRanks.set(item.id, index);
  });

  const availableQuestions = TARGETED_QUESTIONS.filter((question) => !(question.id in answers));

  if (availableQuestions.length === 0) {
    return null;
  }

  const rankedQuestions = availableQuestions
    .map((question) => {
      const uniqueTargets = Array.from(new Set(question.targets ?? []));
      let priority = 0;

      for (const target of uniqueTargets) {
        const rank = candidateRanks.get(target);

        if (rank === 0) {
          priority += 40;
        } else if (rank === 1) {
          priority += 28;
        } else if (rank === 2) {
          priority += 18;
        } else if (rank === 3) {
          priority += 10;
        }

        if (coverage[target] === 0) {
          priority += 20;
        } else if (coverage[target] === 1) {
          priority += 10;
        }
      }

      if (question.targets?.includes("balanced") && coverage.balanced < 2) {
        priority += 6;
      }

      for (const tag of question.bonusTags ?? []) {
        if (selectedTags.has(tag)) {
          priority += 4;
        }
      }

      return {
        question,
        priority,
      };
    })
    .sort((left, right) => right.priority - left.priority);

  return serializeQuestion(rankedQuestions[0].question);
}

function serializeQuestion(question: QuestionDefinition): QuestionPayload {
  return {
    id: question.id,
    prompt: question.prompt,
    description: question.description,
    type: question.type,
    options: question.options,
    maxSelections: question.maxSelections,
    source: question.source,
    minDate: question.minDate,
    maxDate: question.type === "date" ? question.maxDate ?? getTodayDateString() : undefined,
  };
}

function getAnsweredCount(answers: AnswerStore) {
  return Object.keys(answers).length;
}

function getDisplayAnsweredCount(answers: AnswerStore) {
  return Object.keys(answers).filter((key) => !PRELUDE_QUESTION_IDS.has(key)).length;
}

function describeHabits(answers: AnswerStore) {
  return asArray(answers.habits).map((habitId) => HABIT_LABELS[habitId]).filter(Boolean);
}

function getPotentialFocuses(primary: ConstitutionId, secondary?: ConstitutionId) {
  return Array.from(new Set([...(POTENTIAL_FOCUS[primary] ?? []), ...(secondary ? POTENTIAL_FOCUS[secondary] ?? [] : [])])).slice(
    0,
    3,
  );
}

function buildBirthTimingSummary(profile: BirthTimingProfile | undefined, primary: ConstitutionId, secondary?: ConstitutionId) {
  if (!profile) {
    return "本次结果主要依据问答体感与当前节气节律生成，未叠加个人出生节律参考。";
  }

  const focuses = getPotentialFocuses(primary, secondary).slice(0, 2).join("、");

  return `从个人五运六气参考看，您出生于${profile.yearLabel}${profile.annualMovement}之年，生时节律落在${profile.birthWindow.label}（${profile.birthWindow.qi}）。这提示平时可更留意${focuses || "寒热、燥湿与气机升降"}这类感受，本次问答呈现出的体质线索与这一背景有一定呼应。`;
}

function getReasonFragments(tags: Set<string>, recommendation: RecommendationDefinition, primary: ConstitutionId, secondary?: ConstitutionId) {
  const fragments: string[] = [];

  if (recommendation.constitutionWeights[primary]) {
    fragments.push(`更贴合${CONSTITUTION_META[primary].label}的调养重点`);
  }

  if (secondary && recommendation.constitutionWeights[secondary]) {
    fragments.push(`也能兼顾${CONSTITUTION_META[secondary].label}`);
  }

  for (const [tag, weight] of Object.entries(recommendation.tagWeights)) {
    if (weight > 0 && tags.has(tag)) {
      const label = TAG_REASON_MAP[tag];

      if (label) {
        fragments.push(label);
      }
    }
  }

  return fragments.filter((text, index, array) => array.indexOf(text) === index).slice(0, 2);
}

function rankRecommendations(
  definitions: RecommendationDefinition[],
  primary: ConstitutionId,
  secondary: ConstitutionId | undefined,
  tags: Set<string>,
  limit: number,
) {
  return definitions
    .map((definition) => {
      let score = (definition.constitutionWeights[primary] ?? 0) * 1.25;

      if (secondary) {
        score += definition.constitutionWeights[secondary] ?? 0;
      }

      for (const tag of tags) {
        score += definition.tagWeights[tag] ?? 0;
      }

      return {
        definition,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ definition }) => ({
      id: definition.id,
      name: definition.name,
      reason: `${definition.benefit}${getReasonFragments(tags, definition, primary, secondary).length > 0 ? ` ${getReasonFragments(tags, definition, primary, secondary).join("，")}。` : ""}`,
    }));
}

function buildFallbackNarrative(result: Omit<AssessmentResult, "narrative">): NarrativeBlocks {
  const secondaryText = result.secondary ? `，兼有${result.secondary.label}线索` : "";
  const moves = result.baduanjin.map((item) => item.name).join("、");
  const sachets = result.sachets.map((item) => item.name).join("、");
  const potentialFocuses = getPotentialFocuses(result.primary.id, result.secondary?.id);

  return {
    headline: result.profileTitle,
    constitutionSummary: `这次问答更偏向${result.primary.label}${secondaryText}。主要依据是${result.primary.reasons.slice(0, 3).join("、")}，平时可顺带留意${potentialFocuses.slice(0, 2).join("、")}。`,
    personalRhythmSummary: buildBirthTimingSummary(result.birthTimingProfile, result.primary.id, result.secondary?.id),
    seasonalSummary: `${result.seasonalContext.annualSummary} 当前建议先顺着${result.seasonalContext.currentWindow.qi}到${result.seasonalContext.nextWindow.qi}的节律做收放。`,
    exerciseSummary: `八段锦优先练 ${moves}，动作不求快，重在呼吸匀、节奏稳。`,
    sachetSummary: `香囊建议先用 ${sachets}，理由都围绕你目前的体质倾向、作息习惯和当令气候来定。`,
    lifestyleTip:
      result.habits.length > 0
        ? `最近先把“${result.habits[0]}”这件事稳住，效果通常会比额外加很多动作更明显。`
        : "最近先把作息、饮食和运动节律稳住，再看体感变化。",
  };
}

function buildAssistantMessage(answers: AnswerStore, nextQuestion: QuestionPayload | null) {
  const answered = getAnsweredCount(answers);
  const targetedAsked = TARGETED_QUESTIONS.filter((question) => question.id in answers).length;

  if (answered === 0) {
    return "你好，我是扁小鹊。我们用 9 个问题，做一次体质倾向初筛，再给你八段锦和香囊建议。";
  }

  if (!nextQuestion) {
    return "线索已经够了，我把体质、当令调养和练习建议一起收束成一张结果卡。";
  }

  if (nextQuestion.id === "birthDate") {
    return "我再记一下出生年月日，用来结合个人五运六气做一个轻量参考。";
  }

  if (nextQuestion.id === "mainSignals") {
    return "好，我们开始进入体感辨识，我会先抓你最近最想改善的状态。";
  }

  if (nextQuestion.id === "habits") {
    return "收到，我再补一个生活习惯问题，让后面的推荐更贴近你。";
  }

  if (targetedAsked === 0) {
    return "好的，我先沿着你最明显的信号，追问几项区分度最高的条目。";
  }

  if (targetedAsked >= 3) {
    return "方向已经比较清楚了，我再确认一个关键感觉。";
  }

  return "继续，我把体质和当下节气因素一起对齐一下。";
}

async function evaluateAssessment(answers: AnswerStore, seasonalContext: SeasonalContext) {
  const { scores, selectedTags, birthTimingProfile } = scoreAnswers(answers);
  const balanced = scores.find((item) => item.id === "balanced")!;
  const biased = scores.filter((item) => item.id !== "balanced").sort((left, right) => right.score - left.score);
  const primaryBiased = biased[0];
  const secondaryBiased = biased[1];
  const isBalancedDominant = balanced.score >= 64 && primaryBiased.score < 48;

  const primaryId = isBalancedDominant ? "balanced" : primaryBiased.id;
  const secondaryId =
    !isBalancedDominant && secondaryBiased && secondaryBiased.score >= primaryBiased.score - 10 && secondaryBiased.score >= 48
      ? secondaryBiased.id
      : undefined;

  const primaryScore = scores.find((item) => item.id === primaryId)!;
  const secondaryScore = secondaryId ? scores.find((item) => item.id === secondaryId) : undefined;
  const allTags = new Set<string>(selectedTags);

  for (const tag of seasonalContext.currentWindow.tags) {
    allTags.add(tag);
  }

  for (const tag of seasonalContext.nextWindow.tags) {
    allTags.add(tag);
  }

  for (const tag of birthTimingProfile?.tags ?? []) {
    allTags.add(tag);
  }

  const baduanjin = rankRecommendations(BADUANJIN_RECOMMENDATIONS, primaryId, secondaryId, allTags, 3);
  const sachets = rankRecommendations(SACHET_RECOMMENDATIONS, primaryId, secondaryId, allTags, 2);
  const potentialFocuses = getPotentialFocuses(primaryId, secondaryId);

  const baseResult: Omit<AssessmentResult, "narrative"> = {
    profileTitle:
      primaryId === "balanced"
        ? "当前以平和调养为主"
        : secondaryId
          ? `${CONSTITUTION_META[primaryId].label}为主，兼见${CONSTITUTION_META[secondaryId].label}`
          : `${CONSTITUTION_META[primaryId].label}调养建议`,
    summary:
      primaryId === "balanced"
        ? `整体状态偏稳，建议继续做顺时调养，把作息、活动和情绪波动维持在较平衡的节律里，并留意${potentialFocuses.slice(0, 2).join("、")}。`
        : `这次问答更偏向${CONSTITUTION_META[primaryId].label}${secondaryId ? `，兼有${CONSTITUTION_META[secondaryId].label}` : ""}。结合个人节律参考，后续可优先留意${potentialFocuses.slice(0, 2).join("、")}。`,
    primary: {
      id: primaryId,
      label: CONSTITUTION_META[primaryId].label,
      score: primaryScore.score,
      description: CONSTITUTION_META[primaryId].description,
      reasons: primaryScore.reasons,
    },
    secondary: secondaryScore
      ? {
          id: secondaryId!,
          label: CONSTITUTION_META[secondaryId!].label,
          score: secondaryScore.score,
          description: CONSTITUTION_META[secondaryId!].description,
          reasons: secondaryScore.reasons,
        }
      : undefined,
    scores: scores
      .slice()
      .sort((left, right) => right.score - left.score)
      .map((item) => ({
        id: item.id,
        label: CONSTITUTION_META[item.id].label,
        score: item.score,
      })),
    seasonalContext,
    birthTimingProfile,
    baduanjin,
    sachets,
    habits: describeHabits(answers),
    disclaimer:
      "本结果用于健康管理型初筛，不替代医疗诊断；若长期不适、症状明显或正在治疗，请结合线下面诊。",
    sourceNote:
      "体质题目参考《GB/T 46939—2025 中医体质分类与判定》附录A，并结合出生日期对应的个人五运六气参考、日常习惯与当下节律做简化推荐。",
  };

  const generatedNarrative = await generateQwenNarrative(baseResult);

  return {
    ...baseResult,
    narrative: {
      ...buildFallbackNarrative(baseResult),
      ...generatedNarrative,
    },
  } satisfies AssessmentResult;
}

export async function buildAssessmentTurn(rawAnswers: unknown, now = new Date()): Promise<TurnResponse> {
  const answers = normalizeAnswers(rawAnswers);
  const seasonalContext = getSeasonalContext(now);
  const nextQuestion = getNextQuestion(answers);

  if (nextQuestion) {
    return {
      stage: "question",
      assistantMessage: buildAssistantMessage(answers, nextQuestion),
      question: nextQuestion,
      progress: {
        answered: getDisplayAnsweredCount(answers),
        total: DISPLAY_QUESTION_LIMIT,
      },
      seasonalContext,
    };
  }

  return {
    stage: "result",
    assistantMessage: buildAssistantMessage(answers, null),
    result: await evaluateAssessment(answers, seasonalContext),
    progress: {
      answered: DISPLAY_QUESTION_LIMIT,
      total: DISPLAY_QUESTION_LIMIT,
    },
    seasonalContext,
  };
}
