import { LocalHashEmbeddingModel } from "../rag.js";
export function evaluateRetrieval(retriever, cases) {
  const model = new LocalHashEmbeddingModel();
  const indexed = retriever.library.sources.map((s) => ({
    id: s.id,
    vector: model.embed(`${s.title} ${s.tags.join(" ")} ${s.content}`),
  }));
  const rows = cases.map((c) => {
    const v = model.embed(c.query);
    const baseline = indexed
      .map((s) => ({
        id: s.id,
        score: s.vector.reduce((n, x, i) => n + x * v[i], 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.id);
    const actual = retriever.search(c.query, 3).map((s) => s.id);
    return {
      ...c,
      actual,
      baseline,
      hit: c.expected.length
        ? actual.some((id) => c.expected.includes(id))
        : actual.length === 0,
      baselineHit: c.expected.length
        ? baseline.some((id) => c.expected.includes(id))
        : baseline.length === 0,
    };
  });
  const metrics = (key) =>
    Object.fromEntries(
      ["all", "positive", "en", "zh", "zh-natural", "negative"].map((group) => {
        const selected = rows.filter(
          (c) =>
            group === "all" ||
            (group === "positive" ? c.expected.length : c.language === group),
        );
        const passed = selected.filter((c) => c[key]).length;
        return [
          group,
          {
            passed,
            total: selected.length,
            rate: Number((passed / selected.length).toFixed(4)),
          },
        ];
      }),
    );
  return {
    libraryVersion: retriever.version,
    libraryHash: retriever.hash,
    scope: `${cases.length} curated smoke cases; positive hit@3 and negative abstention; same corpus/hash model baseline. Not an independent benchmark or a human learning study. No live LLM.`,
    current: metrics("hit"),
    hashOnlyBaseline: metrics("baselineHit"),
    rows,
  };
}
