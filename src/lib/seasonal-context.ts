import type { BirthTimingProfile, ClimateWindow, SeasonalContext } from "@/lib/types";

const STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;

const STEM_TO_FIVE_MOVEMENTS: Record<(typeof STEMS)[number], string> = {
  甲: "土运太过",
  乙: "金运不及",
  丙: "水运太过",
  丁: "木运不及",
  戊: "火运太过",
  己: "土运不及",
  庚: "金运太过",
  辛: "水运不及",
  壬: "木运太过",
  癸: "火运不及",
};

const BRANCH_TO_CLIMATE: Record<
  (typeof BRANCHES)[number],
  { sitian: string; zaiquan: string; summary: string; tags: string[] }
> = {
  子: {
    sitian: "少阴君火司天",
    zaiquan: "阳明燥金在泉",
    summary: "火气上承、燥气在下，宜兼顾宁心护津与润燥。",
    tags: ["fire", "dry"],
  },
  丑: {
    sitian: "太阴湿土司天",
    zaiquan: "太阳寒水在泉",
    summary: "湿土偏盛、寒水潜伏，宜健脾化湿并护阳。",
    tags: ["damp", "cold"],
  },
  寅: {
    sitian: "少阳相火司天",
    zaiquan: "厥阴风木在泉",
    summary: "相火与风木相应，宜疏肝理气、少熬夜。",
    tags: ["fire", "wind", "spring-rise"],
  },
  卯: {
    sitian: "阳明燥金司天",
    zaiquan: "少阴君火在泉",
    summary: "燥气偏著，宜护肺津、少辛燥。",
    tags: ["dry", "fire"],
  },
  辰: {
    sitian: "太阳寒水司天",
    zaiquan: "太阴湿土在泉",
    summary: "寒湿互见，宜温中助阳并顾脾胃运化。",
    tags: ["cold", "damp"],
  },
  巳: {
    sitian: "厥阴风木司天",
    zaiquan: "少阳相火在泉",
    summary: "风木升发明显，宜舒肝理气、避免情绪郁滞。",
    tags: ["wind", "fire", "spring-rise"],
  },
  午: {
    sitian: "少阴君火司天",
    zaiquan: "阳明燥金在泉",
    summary: "君火偏显、燥气伏于下，宜宁心护津并防郁热。",
    tags: ["fire", "dry"],
  },
  未: {
    sitian: "太阴湿土司天",
    zaiquan: "太阳寒水在泉",
    summary: "湿土较重，宜健脾化湿、少甜腻。",
    tags: ["damp", "cold"],
  },
  申: {
    sitian: "少阳相火司天",
    zaiquan: "厥阴风木在泉",
    summary: "相火渐扬，宜规律作息、避免火郁。",
    tags: ["fire", "wind"],
  },
  酉: {
    sitian: "阳明燥金司天",
    zaiquan: "少阴君火在泉",
    summary: "燥气偏盛，宜润燥养阴并顾咽鼻不适。",
    tags: ["dry", "fire", "autumn"],
  },
  戌: {
    sitian: "太阳寒水司天",
    zaiquan: "太阴湿土在泉",
    summary: "寒湿夹杂，宜温养阳气并稳住脾胃。",
    tags: ["cold", "damp", "winter"],
  },
  亥: {
    sitian: "厥阴风木司天",
    zaiquan: "少阳相火在泉",
    summary: "风木鼓动，宜舒展气机、减少情绪波动。",
    tags: ["wind", "fire"],
  },
};

const CLIMATE_WINDOWS: ClimateWindow[] = [
  {
    id: "first-qi",
    label: "初之气",
    range: "大寒至春分",
    qi: "厥阴风木",
    summary: "风木初升，宜舒肝护阳，少寒凉、少久坐。",
    tags: ["wind", "spring-rise", "cold"],
  },
  {
    id: "second-qi",
    label: "二之气",
    range: "春分至小满",
    qi: "少阴君火",
    summary: "阳气渐盛，宜宁心护津，兼顾升发有序。",
    tags: ["wind", "fire", "spring-rise"],
  },
  {
    id: "third-qi",
    label: "三之气",
    range: "小满至大暑",
    qi: "少阳相火",
    summary: "相火渐旺，宜清心和中，避免久熬与辛燥。",
    tags: ["fire", "summer-prep"],
  },
  {
    id: "fourth-qi",
    label: "四之气",
    range: "大暑至秋分",
    qi: "太阴湿土",
    summary: "湿气偏重，宜健脾祛湿，饮食清淡。",
    tags: ["damp", "summer"],
  },
  {
    id: "fifth-qi",
    label: "五之气",
    range: "秋分至小雪",
    qi: "阳明燥金",
    summary: "燥气当令，宜润肺护津，减少辛辣燥热。",
    tags: ["dry", "autumn"],
  },
  {
    id: "final-qi",
    label: "终之气",
    range: "小雪至大寒",
    qi: "太阳寒水",
    summary: "寒水主时，宜温养阳气，减少过劳耗散。",
    tags: ["cold", "winter"],
  },
];

function formatDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateInput(raw: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);

  if (!matched) {
    return null;
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const candidate = localDate(year, month - 1, day);

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return candidate;
}

function localDate(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, day, 0, 0, 0, 0);
}

function getClimateWindowIndex(date: Date) {
  const year = date.getFullYear();
  const springEquinox = localDate(year, 2, 20);
  const grainFull = localDate(year, 4, 21);
  const greatHeat = localDate(year, 6, 22);
  const autumnEquinox = localDate(year, 8, 22);
  const minorSnow = localDate(year, 10, 22);
  const greatCold = localDate(year, 0, 20);

  if (date >= minorSnow || date < greatCold) {
    return 5;
  }

  if (date >= autumnEquinox) {
    return 4;
  }

  if (date >= greatHeat) {
    return 3;
  }

  if (date >= grainFull) {
    return 2;
  }

  if (date >= springEquinox) {
    return 1;
  }

  return 0;
}

function getSexagenaryYear(date: Date) {
  const lichun = localDate(date.getFullYear(), 1, 4);
  const effectiveYear = date < lichun ? date.getFullYear() - 1 : date.getFullYear();
  const offset = effectiveYear - 1984;
  const stem = STEMS[((offset % 10) + 10) % 10];
  const branch = BRANCHES[((offset % 12) + 12) % 12];
  return {
    year: effectiveYear,
    stem,
    branch,
    label: `${stem}${branch}年`,
  };
}

export function getSeasonalContext(date = new Date()): SeasonalContext {
  const sexagenaryYear = getSexagenaryYear(date);
  const annualMovement = STEM_TO_FIVE_MOVEMENTS[sexagenaryYear.stem];
  const annualClimate = BRANCH_TO_CLIMATE[sexagenaryYear.branch];
  const currentIndex = getClimateWindowIndex(date);
  const currentWindow = CLIMATE_WINDOWS[currentIndex];
  const nextWindow = CLIMATE_WINDOWS[(currentIndex + 1) % CLIMATE_WINDOWS.length];

  return {
    formattedDate: formatDate(date),
    annualLabel: `${sexagenaryYear.label} · ${annualMovement} · ${annualClimate.sitian}`,
    annualSummary: `${annualClimate.summary} 当前所处${currentWindow.label}（${currentWindow.range}），下一阶段为${nextWindow.label}（${nextWindow.range}）。`,
    currentWindow,
    nextWindow,
    badge: `${sexagenaryYear.label} ${currentWindow.label}`,
  };
}

export function getBirthTimingProfile(birthDate: string): BirthTimingProfile | undefined {
  const parsedDate = parseDateInput(birthDate);

  if (!parsedDate) {
    return undefined;
  }

  const sexagenaryYear = getSexagenaryYear(parsedDate);
  const annualMovement = STEM_TO_FIVE_MOVEMENTS[sexagenaryYear.stem];
  const annualClimate = BRANCH_TO_CLIMATE[sexagenaryYear.branch];
  const birthWindow = CLIMATE_WINDOWS[getClimateWindowIndex(parsedDate)];
  const tags = Array.from(new Set([...annualClimate.tags, ...birthWindow.tags]));

  return {
    birthDate,
    yearLabel: sexagenaryYear.label,
    annualMovement,
    sitian: annualClimate.sitian,
    zaiquan: annualClimate.zaiquan,
    birthWindow,
    summary: `从个人五运六气参考看，您出生于${sexagenaryYear.label}${annualMovement}之年，生时节律落在${birthWindow.label}（${birthWindow.qi}）。这通常提示调养时可多留意与${birthWindow.qi}相关的寒热、燥湿和气机升降特点。`,
    tags,
  };
}
