import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { LocalHashEmbeddingModel } from "../rag.js";

export const LIBRARY_URL = new URL(
  "../../data/academic/library.json",
  import.meta.url,
);
const aliases = {
  biodiversity: "生物多样性",
  commons: "公共资源",
  "public goods": "公共品",
  equity: "公平",
  fairness: "公平",
  inequality: "分配 贫困",
  justice: "公平 权利",
  externalities: "外部性",
  externality: "外部性",
  resilience: "韧性",
  innovation: "创新 科技",
  technology: "科技",
  "clean technology": "清洁技术",
  cooperation: "合作",
  donation: "捐赠",
  "social capital": "社会 互助",
  "planetary boundaries": "行星边界",
  "natural capital": "自然资本",
  climate: "气候",
  carbon: "碳定价 减排",
  emissions: "减排 污染",
  flood: "洪水 受灾",
  seeds: "种子 救生",
  vulnerability: "脆弱性",
  "social tipping": "集体行动 转型",
  education: "教育",
  risk: "风险",
  "opportunity cost": "机会成本",
  "marginal cost": "边际成本",
  "marginal benefit": "边际收益",
  "pareto efficiency": "帕累托效率",
  "free rider": "搭便车",
  "free riding": "搭便车",
  "prisoner's dilemma": "囚徒困境",
  "risk pooling": "风险共担",
  diversification: "分散风险",
  "private gains": "私人收益",
  "external costs": "外部成本 社会成本",
  "transaction costs": "交易成本",
  bargaining: "协商",
  "bargaining power": "议价权",
  "procedural fairness": "程序公平",
  "equality of opportunity": "机会平等",
  "repeated interaction": "重复博弈",
  reciprocity: "互惠",
  monitoring: "监督",
  "common shock": "共同冲击",
  efficiency: "效率",
  "social optimality": "社会最优",
  irreversibility: "不可逆性",
  "future options": "保留选择",
  "maximum sustainable yield": "最大可持续产量",
  uncertainty: "不确定性",
  "precautionary harvesting": "预防性采收 安全余量",
  "safety margin": "安全余量",
  overharvesting: "超采",
  "regeneration capacity": "再生能力",
  "ecosystem services": "生态系统服务",
  "polluter pays": "污染者付费",
  "precautionary principle": "预防原则",
  transparency: "透明",
  consensus: "共识",
  "due diligence": "尽职尽责",
  communication: "沟通",
  "collective action": "集体行动",
  "costly sanctions": "制裁成本",
  "carrying capacity": "环境承载力",
  "sustainable yield": "可持续采收",
  "renewable resources": "可再生资源",
  "renewable resource": "可再生资源",
  "ecological footprint": "生态足迹",
  "social stratification": "社会分层",
  "social mobility": "社会流动",
  socialization: "社会化",
  "bystander effect": "旁观者效应",
  "diffusion of responsibility": "责任分散",
  "procedural justice": "程序公平",
  "distributive justice": "分配公平",
  utilitarianism: "功利主义",
  deontology: "义务论",
  "common pool resources": "公共资源",
  "common-pool resources": "公共资源",
  受伤: "伤势",
  保命: "救生",
  没钱: "贫困",
  穷: "资源少",
  抢夺: "排斥",
  耗尽: "资源枯竭",
  发明: "科技 创新",
};
export const isTeachingSource = (source) =>
  ["textbook", "teaching_guide"].includes(source.kind);
export function normalizeQuery(text) {
  let value = String(text).normalize("NFKC").toLowerCase();
  // Match phrases before their component words (e.g. clean technology).
  for (const [alias, zh] of Object.entries(aliases).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    const pattern = /[a-z]/.test(alias)
      ? new RegExp(`\\b${alias}\\b`, "g")
      : new RegExp(alias, "g");
    value = value.replace(pattern, zh);
  }
  return value;
}
export function validateLibrary(library) {
  if (
    !library.version ||
    !Array.isArray(library.sources) ||
    !library.sources.length
  )
    throw new Error("invalid_academic_library");
  const ids = new Set();
  for (const s of library.sources) {
    if (
      !/^[a-z][a-z0-9-]+$/.test(s.id) ||
      ids.has(s.id) ||
      !["economy", "environment", "society"].includes(s.domain) ||
      !["radical", "balanced", "conservative"].includes(s.perspective) ||
      !Array.isArray(s.tags) ||
      !s.tags.length
    )
      throw new Error("invalid_academic_source");
    for (const key of [
      "title",
      "originalTitle",
      "content",
      "limitations",
      "application",
      "authority",
      "rights",
      "locator",
      "verification",
    ])
      if (typeof s[key] !== "string" || !s[key].trim())
        throw new Error(`missing_academic_${key}`);
    for (const key of ["url", "originalUrl"]) {
      const url = new URL(s[key]);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("unsafe_academic_url");
    }
    if (
      s.originalFormat !== undefined &&
      !["pdf", "web", "link"].includes(s.originalFormat)
    )
      throw new Error("invalid_original_format");
    if (
      isTeachingSource(s) &&
      (typeof s.edition !== "string" ||
        !s.edition.trim() ||
        typeof s.workId !== "string" ||
        !/^[a-z][a-z0-9-]+$/.test(s.workId) ||
        !Array.isArray(s.concepts) ||
        !s.concepts.length ||
        s.concepts.some((c) => typeof c !== "string" || !c.trim()))
    )
      throw new Error("invalid_textbook_metadata");
    if (s.supportingUrls !== undefined) {
      if (!Array.isArray(s.supportingUrls))
        throw new Error("invalid_supporting_urls");
      for (const link of s.supportingUrls) {
        const url = new URL(link.url);
        if (
          !link.title ||
          url.protocol !== "https:" ||
          url.username ||
          url.password
        )
          throw new Error("unsafe_academic_url");
      }
    }
    ids.add(s.id);
  }
  return library;
}
export async function createAcademicRetriever(libraryPath = LIBRARY_URL) {
  const raw = await readFile(libraryPath, "utf8");
  const library = validateLibrary(JSON.parse(raw));
  const hash = createHash("sha256").update(raw).digest("hex");
  const model = new LocalHashEmbeddingModel();
  const docs = library.sources.map((s) => ({
    source: s,
    vector: model.embed(`${s.title} ${s.tags.join(" ")} ${s.content}`),
  }));
  const statistics = {
    works: new Set(library.sources.map((s) => s.workId || s.id)).size,
    textbooks: new Set(
      library.sources.filter((s) => s.kind === "textbook").map((s) => s.workId),
    ).size,
    domains: Object.fromEntries(
      ["economy", "environment", "society"].map((d) => [
        d,
        docs.filter(({ source }) => source.domain === d).length,
      ]),
    ),
    kinds: Object.fromEntries(
      [...new Set(library.sources.map((s) => s.kind))].map((kind) => [
        kind,
        docs.filter(({ source }) => source.kind === kind).length,
      ]),
    ),
  };
  const frequency = (tag) =>
    docs.filter(({ source }) => source.tags.includes(tag)).length;
  function search(query, limit = 6, options = {}) {
    limit = Math.max(0, Math.min(10, Math.floor(limit)));
    const normalized = normalizeQuery(query),
      focus = normalizeQuery(options.focus || "");
    const vector = model.embed(normalized);
    const ranked = docs
      .map(({ source, vector: v }) => {
        const matchedTags = source.tags.filter((tag) =>
          normalized.includes(tag),
        );
        const focusedTags = source.tags.filter((tag) => focus.includes(tag));
        const lexical = matchedTags.reduce(
          (n, tag) => n + Math.log(1 + docs.length / frequency(tag)),
          0,
        );
        const focusScore = focusedTags.reduce(
          (n, tag) => n + 4 * Math.log(1 + docs.length / frequency(tag)),
          0,
        );
        const cosine = v.reduce((sum, x, i) => sum + x * vector[i], 0);
        const personaBoost = source.perspective === options.persona ? 0.8 : 0;
        return {
          ...source,
          score: Number(
            (lexical + focusScore + cosine * 0.25 + personaBoost).toFixed(4),
          ),
          match: {
            matchedTags,
            focusedTags,
            personaMatch: personaBoost > 0,
            selection: "relevance",
          },
        };
      })
      .filter((s) => s.match.matchedTags.length || s.match.focusedTags.length)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    // Never return a hash-collision-only hit; unknown subjects explicitly abstain.
    const selected = ranked.slice(0, limit);
    if (options.coverage && limit >= 4) {
      const reserved = new Set(selected.slice(0, 2).map((s) => s.id));
      const add = (matches, why) => {
        const counts = Object.fromEntries(
          ["economy", "environment", "society"].map((d) => [
            d,
            selected.filter((s) => s.domain === d).length,
          ]),
        );
        // The highest-ranked candidate may conflict with a protected domain or
        // lens. Try later lexical hits before giving up on this coverage goal.
        for (const candidate of ranked.filter(matches)) {
          if (selected.some((s) => s.id === candidate.id)) continue;
          const index = selected.findLastIndex((s, i) => {
            if (
              reserved.has(s.id) ||
              (counts[s.domain] === 1 && s.domain !== candidate.domain)
            )
              return false;
            const next = selected.map((v, n) => (n === i ? candidate : v));
            const preserve = (predicate) =>
              !selected.some(predicate) || next.some(predicate);
            return (
              preserve((v) => v.perspective === options.persona) &&
              preserve((v) => v.perspective !== options.persona) &&
              preserve(isTeachingSource) &&
              preserve((v) => !isTeachingSource(v))
            );
          });
          const addition = {
            ...candidate,
            match: { ...candidate.match, selection: why },
          };
          if (selected.length < limit) selected.push(addition);
          else if (index >= 0) selected[index] = addition;
          else continue;
          reserved.add(candidate.id);
          return true;
        }
        return false;
      };
      for (const domain of ["economy", "environment", "society"])
        if (!selected.some((s) => s.domain === domain))
          add((s) => s.domain === domain, "domain_coverage");
      if (
        options.persona &&
        !selected.some((s) => s.perspective === options.persona)
      )
        add((s) => s.perspective === options.persona, "persona_lens");
      if (
        options.persona &&
        selected.every((s) => s.perspective === options.persona)
      )
        add((s) => s.perspective !== options.persona, "different_perspective");
      // Theory and research complement each other, but only among lexical hits.
      // Never force an unrelated textbook into a focused rebuttal.
      if (!selected.some(isTeachingSource))
        add(isTeachingSource, "textbook_foundation");
      if (!selected.some((s) => !isTeachingSource(s)))
        add((s) => !isTeachingSource(s), "research_context");
    }
    return selected;
  }
  return {
    academic: true,
    model: "local-hash-256+zh-keywords-v2",
    size: docs.length,
    version: library.version,
    hash,
    library,
    search,
    describe: () => ({
      version: library.version,
      hash,
      sources: docs.length,
      model: "local-hash-256+zh-keywords-v2",
      statistics,
      translationPolicy: library.translationPolicy,
      personaPolicy: library.personaPolicy,
      textbookPolicy: library.textbookPolicy,
      semanticModel: false,
    }),
  };
}
