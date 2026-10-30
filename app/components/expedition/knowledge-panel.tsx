"use client";
import { useState } from "react";
import { apiRequest, academicOriginalUrl } from "@/lib/expedition";

const domains: Record<string, string> = {
  economy: "经济",
  environment: "环境",
  society: "社会",
};
const lenses: Record<string, string> = {
  radical: "主动转型",
  balanced: "多目标权衡",
  conservative: "风险与守护",
};
type Source = {
  id: string;
  title: string;
  originalTitle: string;
  authors: string;
  year: number;
  publisher: string;
  domain: string;
  perspective: string;
  content: string;
  limitations: string;
  authority: string;
  locator: string;
  url: string;
  originalUrl: string;
  originalExcerpt: string;
  excerptZh: string;
  rights: string;
  kind: string;
  edition?: string;
  concepts?: string[];
  originalFormat?: "pdf" | "web" | "link";
  originalLabel?: string;
  supportingUrls?: { title: string; url: string }[];
  match?: { matchedTags: string[]; focusedTags: string[]; selection: string };
  archive?: { status: string; sha256?: string };
};
type Reading = { sourceId: string; application: string; eventSeqs: number[] };
function SourceCard({
  source: s,
  reading,
}: {
  source: Source;
  reading?: Reading;
}) {
  return (
    <article className="academic-source" data-source-id={s.id}>
      <p className="overline">
        {domains[s.domain]} · {lenses[s.perspective]} · {s.year}
      </p>
      <h4>{s.title}</h4>
      {["textbook", "teaching_guide"].includes(s.kind) && (
        <p className="fineprint">
          {s.kind === "textbook" ? "教材理论" : "课程教学指南"} · {s.edition}
          <br />
          概念：{s.concepts?.join("、")}。不等同于新的实证研究。
        </p>
      )}
      <p>{s.content}</p>
      <p className="academic-limit">
        <strong>适用边界：</strong>
        {s.limitations}
      </p>
      {reading && (
        <div className="academic-application">
          <p>{reading.application}</p>
          <small>
            关联真实事件：{reading.eventSeqs.map((n) => `#${n}`).join("、")}
          </small>
        </div>
      )}
      <details>
        <summary>出处、原文与检索依据</summary>
        <p>
          {s.originalTitle}
          <br />
          {s.authors} · {s.publisher}
        </p>
        <p>{s.authority}</p>
        <p>定位：{s.locator}</p>
        {s.originalExcerpt && (
          <p>
            英文短摘录：{s.originalExcerpt}
            <br />
            中文：{s.excerptZh}
          </p>
        )}
        {s.match && (
          <p>
            命中：{s.match.matchedTags.join("、")}；当前申辩重点：
            {s.match.focusedTags.join("、") || "无"}；
            {s.match.selection === "domain_coverage"
              ? "补足跨领域视角"
              : s.match.selection === "textbook_foundation"
                ? "补充相关教材基础"
                : s.match.selection === "research_context"
                  ? "补充相关研究背景"
                  : "按相关性选择"}
            。
          </p>
        )}
        <p className="academic-links">
          <a href={s.url} target="_blank" rel="noreferrer">
            官方出处 ↗
          </a>
          <a href={s.originalUrl} target="_blank" rel="noreferrer">
            {s.originalLabel ||
              (s.originalFormat === "web"
                ? "原文教材章节"
                : s.originalFormat === "link"
                  ? "外部原件"
                  : "原文 PDF")}{" "}
            ↗
          </a>
          {s.archive?.status === "available" ? (
            <a
              href={academicOriginalUrl(s.id)}
              target="_blank"
              rel="noreferrer"
            >
              本地原件 ↗
            </a>
          ) : (
            <span>
              本地原件：
              {["web", "link"].includes(s.originalFormat || "")
                ? "仅保留外部链接，未本地归档"
                : s.archive
                  ? "待下载"
                  : "请到文献目录核对归档状态"}
            </span>
          )}
        </p>
        {s.supportingUrls?.map((link) => (
          <p key={link.url}>
            <a href={link.url} target="_blank" rel="noreferrer">
              {link.title} ↗
            </a>
          </p>
        ))}
        {s.archive?.sha256 && (
          <p className="academic-hash">SHA-256：{s.archive.sha256}</p>
        )}
        <small>{s.rights}</small>
      </details>
    </article>
  );
}
export function AcademicEvidence({
  rag,
  learning = [],
  used,
}: {
  rag: any;
  learning?: Reading[];
  used: boolean;
}) {
  if (!rag?.academic) return null;
  return (
    <section className="academic-evidence" aria-label="本阶段学术依据">
      <h3>从研究回到这场航程</h3>
      <p>
        {used
          ? "以下是模型本阶段引用与具体行为分析。引用编号已校验，但观点解释仍可能有误，可对照原文质疑。"
          : "当前为本地规则裁决：下面是按本阶段问题检索的阅读提示，不代表模型理解了申辩，也不改变规则排序。"}
      </p>
      <p className="fineprint">
        中文结论转述，不是全文翻译。风格标签是游戏阅读视角，不是作者立场。论文不直接决定谁值得生存。
      </p>
      {rag.evidence.map((s: Source) => (
        <SourceCard
          key={s.id}
          source={s}
          reading={learning.find((l) => l.sourceId === s.id)}
        />
      ))}
      <details>
        <summary>本次检索留档</summary>
        <p>版本：{rag.version} · 本地关键词＋哈希向量检索（不是语义大模型）</p>
        <p className="academic-hash">资料库 SHA-256：{rag.libraryHash}</p>
        <pre>{rag.query}</pre>
      </details>
    </section>
  );
}
export function AcademicLibrary() {
  const [data, setData] = useState<{
    sources: Source[];
    version: string;
    statistics?: { works: number; textbooks: number };
  } | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function load() {
    if (loading || data) return;
    setLoading(true);
    setError("");
    try {
      setData(await apiRequest("/knowledge"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <details
      className="academic-library"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>学术文献目录 · 中文结论与原文</summary>
      <p>
        研究支持讨论，不提供唯一的公平答案。激进型偏重主动转型，中立型兼顾合作与权衡，保守型关注风险和韧性；检索相关性优先，不屏蔽不同视角。
      </p>
      {loading && <p>正在读取本地资料库…</p>}
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => void load()}>重试</button>
        </p>
      )}
      {data && (
        <>
          <p>
            {data.version} · 共 {data.sources.length} 份；
            {Object.entries(domains)
              .map(
                ([key, label]) =>
                  `${label} ${data.sources.filter((s) => s.domain === key).length} 份`,
              )
              .join("，")}
            。
            {data.statistics &&
              ` ${data.statistics.works} 个独立来源，其中 ${data.statistics.textbooks} 本教材；同书章节不重复计数。`}
          </p>
          {data.sources.map((s) => (
            <SourceCard key={s.id} source={s} />
          ))}
        </>
      )}
    </details>
  );
}
