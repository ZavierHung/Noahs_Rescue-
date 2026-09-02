'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  ChevronRight,
  CircleAlert,
  CloudLightning,
  Gavel,
  History,
  Landmark,
  Leaf,
  MessageSquareQuote,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, type Disaster, type Judgment } from '@/lib/api';

type DimensionKey = 'economy' | 'environment' | 'society';

type ModelContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => Promise<unknown> | object | string | number | boolean | null;
  }, options?: { signal: AbortSignal }) => void | Promise<void>;
};

type Dimension = {
  key: DimensionKey;
  label: string;
  value: number;
  hint: string;
  color: string;
};

const INITIAL_DIMENSIONS: Dimension[] = [
  { key: 'economy', label: '经济', value: 10, hint: '资源流动平稳，仍有发展空间', color: '#e5ad38' },
  { key: 'environment', label: '环境', value: 10, hint: '生态处于可恢复区间', color: '#4da675' },
  { key: 'society', label: '社会', value: 10, hint: '协作网络运转正常', color: '#5c8fdb' },
];

const ICONS = { economy: Landmark, environment: Leaf, society: Users };

const DISASTER_COPY: Record<DimensionKey, Record<string, string>> = {
  economy: { criticalHigh: '贫富悬殊加剧', high: '先发展再治理', low: '经济萧条', criticalLow: '通货紧缩' },
  environment: { criticalHigh: '生态管制冲突', high: '低碳转型阵痛', low: '生态崩坏', criticalLow: '稳态失衡' },
  society: { criticalHigh: '集体决策低效', high: '全民保障压力', low: '社会失序', criticalLow: '阶层固化' },
};

function getBand(value: number) {
  if (value >= 18) return 'criticalHigh';
  if (value >= 14) return 'high';
  if (value <= 2) return 'criticalLow';
  if (value <= 6) return 'low';
  return 'stable';
}

function getStatus(value: number) {
  const band = getBand(value);
  if (band === 'criticalHigh') return ['极端高位', '系统承压，已触发强烈反馈'];
  if (band === 'high') return ['高位预警', '增长开始产生外部代价'];
  if (band === 'criticalLow') return ['临界崩坏', '系统接近不可逆失衡'];
  if (band === 'low') return ['低位预警', '基础能力正在快速流失'];
  return ['动态平衡', '当前未触发灾难'];
}

export default function Home() {
  const [dimensions, setDimensions] = useState(INITIAL_DIMENSIONS);
  const [rebuttal, setRebuttal] = useState('');
  const [hearing, setHearing] = useState<'idle' | 'reviewing' | 'rebuttal' | 'final'>('idle');
  const [session, setSession] = useState<Judgment | null>(null);
  const [serverDisasters, setServerDisasters] = useState<Disaster[]>([]);
  const [archive, setArchive] = useState<Judgment[]>([]);
  const [apiConnected, setApiConnected] = useState(false);
  const [error, setError] = useState('');
  const [knowledgeMeta, setKnowledgeMeta] = useState({ model: 'local-hash-256', documents: 8 });
  const [llmMeta, setLlmMeta] = useState({ provider: 'minimax', model: 'MiniMax-M2.7', enabled: false });

  useEffect(() => {
    Promise.all([api.health(), api.state(), api.judgments()])
      .then(([health, state, judgments]) => {
        setApiConnected(health.ok);
        setKnowledgeMeta(health.rag);
        setLlmMeta(health.llm);
        setDimensions((current) => current.map((item) => ({ ...item, value: state.attributes[item.key] })));
        setServerDisasters(state.activeDisasters);
        setArchive(judgments);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'WebMCP 工具注册失败。');

    void Promise.resolve(context.registerTool({
      name: 'set_world_state',
      title: '设置世界状态',
      description: '把经济、环境、社会三个属性设置为 1—19 的整数，并更新页面中的灾难状态。',
      inputSchema: {
        type: 'object',
        properties: { economy: { type: 'integer', minimum: 1, maximum: 19 }, environment: { type: 'integer', minimum: 1, maximum: 19 }, society: { type: 'integer', minimum: 1, maximum: 19 } },
        required: ['economy', 'environment', 'society'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const values = input as Record<DimensionKey, number>;
        if (['economy', 'environment', 'society'].some((key) => !Number.isInteger(values[key as DimensionKey]) || values[key as DimensionKey] < 1 || values[key as DimensionKey] > 19)) throw new Error('三个属性都必须是 1—19 的整数。');
        const next = INITIAL_DIMENSIONS.map((item) => ({ ...item, value: values[item.key] }));
        setDimensions(next);
        const state = await api.saveState(values);
        setServerDisasters(state.activeDisasters);
        return { attributes: state.attributes, activeDisasters: state.activeDisasters.map((item) => item.name) };
      },
    }, { signal: lifecycle.signal })).catch(report);

    void Promise.resolve(context.registerTool({
      name: 'start_god_judgment',
      title: '触发上帝审判',
      description: '使用当前已保存的世界状态启动一次随机上帝审判，并让页面进入等待玩家反驳状态。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute() {
        setHearing('reviewing');
        const nextSession = await api.startJudgment();
        setSession(nextSession);
        setArchive((current) => [nextSession, ...current]);
        setHearing('rebuttal');
        return { judgmentId: nextSession.id, god: nextSession.god.name, status: nextSession.status };
      },
    }, { signal: lifecycle.signal })).catch(report);

    return () => lifecycle.abort();
  }, []);

  const activeDisasters = useMemo(
    () => dimensions.map((dimension) => ({ ...dimension, band: getBand(dimension.value) })).filter((dimension) => dimension.band !== 'stable'),
    [dimensions],
  );

  function updateDimension(key: DimensionKey, next: number) {
    setDimensions((current) => current.map((dimension) => dimension.key === key ? { ...dimension, value: next } : dimension));
  }

  async function saveState(nextDimensions = dimensions) {
    try {
      setError('');
      const attributes = Object.fromEntries(nextDimensions.map((item) => [item.key, item.value])) as Record<DimensionKey, number>;
      const state = await api.saveState(attributes);
      setServerDisasters(state.activeDisasters);
      setApiConnected(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function beginHearing() {
    setRebuttal('');
    setSession(null);
    setHearing('reviewing');
    try {
      await saveState();
      const nextSession = await api.startJudgment();
      setSession(nextSession);
      setArchive((current) => [nextSession, ...current]);
      setHearing('rebuttal');
    } catch (cause) {
      setHearing('idle');
      setError((cause as Error).message);
    }
  }

  async function submitRebuttal() {
    if (!rebuttal.trim() || !session) return;
    try {
      const finalSession = await api.rebut(session.id, rebuttal.trim());
      setSession(finalSession);
      setArchive((current) => current.map((item) => item.id === finalSession.id ? finalSession : item));
      setHearing('final');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><Scale /></div>
        <div>
          <p className="eyebrow">WORLD BALANCE CONSOLE</p>
          <h1>神谕 · 世界平衡台</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`status-dot ${apiConnected ? '' : 'is-offline'}`} />
          <span className="hidden text-sm text-muted-foreground sm:inline">{apiConnected ? '本地引擎已连接' : '正在连接本地引擎'}</span>
          <span className="round-pill">手动触发模式</span>
        </div>
      </header>

      <div className="console-grid">
        <section className="control-column" aria-label="世界属性控制">
          <div className="section-heading">
            <div><p className="eyebrow">WORLD STATE</p><h2>调整世界状态</h2></div>
            <span className="range-label">1 — 19</span>
          </div>

          <div className="dimension-stack">
            {dimensions.map((dimension) => {
              const Icon = ICONS[dimension.key];
              const [status, description] = getStatus(dimension.value);
              const band = getBand(dimension.value);
              return (
                <article className={`dimension-card dimension-${dimension.key} band-${band}`} key={dimension.key} style={{ '--dimension': dimension.color } as React.CSSProperties}>
                  <div className="dimension-row">
                    <span className="dimension-icon"><Icon /></span>
                    <div><h3>{dimension.label}</h3><p>{dimension.hint}</p></div>
                    <output className="dimension-value" aria-label={`${dimension.label}值`}>{dimension.value.toString().padStart(2, '0')}</output>
                  </div>
                  <Slider aria-label={`${dimension.label}属性`} className="world-slider" min={1} max={19} step={1} value={[dimension.value]} onValueChange={(value) => updateDimension(dimension.key, typeof value === 'number' ? value : value[0])} onValueCommitted={() => void saveState()} />
                  <div className="thresholds" aria-hidden="true">
                    {[2, 6, 10, 14, 18].map((threshold) => <span key={threshold} className={dimension.value === threshold ? 'is-current' : ''}>{threshold}</span>)}
                  </div>
                  <div className="dimension-feedback"><Sparkles /><strong>{status}</strong><span>{description}</span></div>
                </article>
              );
            })}
          </div>

          <div className="threshold-legend">
            <span><i className="negative" /> 2 / 6 负向灾难</span>
            <span><i className="stable" /> 7—13 稳定区</span>
            <span><i className="positive" /> 14 / 18 正向灾难</span>
          </div>
        </section>

        <section className="main-column">
          <Card className="oracle-card">
            <CardHeader className="oracle-header">
              <div><p className="eyebrow">GOD AGENT LOOP</p><CardTitle className="text-xl">上帝议事庭</CardTitle><CardDescription>读取状态 → 随机选神 → 本地 RAG → 允许反驳 → 最终裁决</CardDescription></div>
              <span className={`agent-state state-${hearing}`}>
                {hearing === 'idle' && '等待触发'}{hearing === 'reviewing' && '正在审阅'}{hearing === 'rebuttal' && '等待反驳'}{hearing === 'final' && '裁决完成'}
              </span>
            </CardHeader>
            <CardContent>
              {hearing === 'idle' && (
                <div className="empty-hearing">
                  <div className="god-seal"><Gavel /></div><h3>三位上帝正在沉默</h3>
                  <p>触发后，系统会从激进、平衡、保守三种价值观中随机选择一位进行审判。</p>
                  <Button size="lg" onClick={beginHearing}>触发上帝审判 <ChevronRight data-icon="inline-end" /></Button>
                </div>
              )}
              {hearing === 'reviewing' && (
                <div className="empty-hearing loading-hearing"><div className="god-seal"><Sparkles /></div><h3>正在编排 Agent Loop</h3><p>读取三维状态，并从本地环保知识库中召回证据……</p></div>
              )}
              {(hearing === 'rebuttal' || hearing === 'final') && (
                <div className="hearing-content">
                  <div className="god-identity"><div className="god-avatar"><Scale /></div><div><span>本轮审判者</span><h3>{session?.god.name}</h3><p>{session?.god.type} · {session?.god.values}</p></div></div>
                  <blockquote>“{session?.initialVerdict.statement}”</blockquote>
                  <div className="evidence-box"><span><BookOpen /> RAG 召回证据 · {session?.rag.evidence[0]?.title}</span><p>{session?.rag.evidence[0]?.content}</p></div>
                  {hearing === 'rebuttal' ? (
                    <div className="rebuttal-box"><label htmlFor="rebuttal">玩家反驳</label><Textarea id="rebuttal" value={rebuttal} onChange={(event) => setRebuttal(event.target.value)} placeholder="说明你的行动背景、公共收益或补救计划……" /><Button onClick={submitRebuttal} disabled={!rebuttal.trim()}>提交反驳并请求最终裁决</Button></div>
                  ) : (
                    <div className="final-stack">
                      <div className="verdict-box"><div><ShieldCheck /><strong>最终裁决 · {session?.finalVerdict?.title}</strong></div><p>{session?.finalVerdict?.statement}</p><ul>{session?.finalVerdict?.measures.map((measure) => <li key={measure}>{measure}</li>)}</ul></div>
                      <Button className="repeat-judgment" variant="outline" onClick={beginHearing}>
                        <Gavel /> 再次手动触发审判
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="disasters" className="intel-tabs">
            <TabsList><TabsTrigger value="disasters"><CloudLightning /> 灾难监测</TabsTrigger><TabsTrigger value="archive"><History /> 审判档案</TabsTrigger></TabsList>
            <TabsContent value="disasters">
              {activeDisasters.length === 0 ? (
                <div className="stable-panel"><ShieldCheck /><div><strong>所有维度处于稳定区</strong><p>拖动任意属性到 2 / 6 / 14 / 18 附近，观察系统反馈。</p></div></div>
              ) : (
                <div className="disaster-grid">
                  {activeDisasters.map((disaster) => {
                    const persisted = serverDisasters.find((item) => item.dimension === disaster.key && item.band === disaster.band);
                    return <article key={disaster.key} style={{ '--dimension': disaster.color } as React.CSSProperties}><CircleAlert /><div><span>{disaster.label} · {disaster.value}</span><strong>{persisted?.name || DISASTER_COPY[disaster.key][disaster.band]}</strong><p>{persisted?.effect}</p></div><small>阈值生效中</small></article>;
                  })}
                </div>
              )}
            </TabsContent>
            <TabsContent value="archive">
              <div className="archive-list">
                {archive.length === 0 ? <div className="archive-panel"><Archive /><div><strong>本地 JSON 档案</strong><p>完成一次审判后，这里会显示状态、RAG 证据、反驳与最终奖惩。</p></div><span>0 条记录</span></div> : archive.map((item) => <article key={item.id}><div><span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span><strong>{item.god.name} · {item.initialVerdict.title}</strong><p>经济 {item.stateSnapshot.attributes.economy} / 环境 {item.stateSnapshot.attributes.environment} / 社会 {item.stateSnapshot.attributes.society}</p></div><small>{item.status === 'final' ? '已裁决' : '待反驳'}</small></article>)}
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <aside className="side-column">
          <Card className="loop-card">
            <CardHeader><p className="eyebrow">ORCHESTRATION</p><CardTitle>Agent 编排</CardTitle></CardHeader>
            <CardContent className="loop-list">
              {[
                ['01', '状态读取器', '读取三属性与灾难快照'], ['02', '上帝路由器', '随机选择价值观人格'], ['03', '本地检索器', '召回环保知识证据'], ['04', '裁决引擎', '生成初判与奖惩'], ['05', '反驳回路', '吸收申辩后作最终裁决'], ['06', '档案写入器', '追加保存到 JSON'],
              ].map(([number, title, body], index) => <div className="loop-step" key={number}><span>{number}</span><div><strong>{title}</strong><p>{body}</p></div>{index < 5 && <i />}</div>)}
            </CardContent>
          </Card>
          <Card className="knowledge-card"><CardHeader><div className="flex items-center justify-between"><CardTitle>模型与知识库</CardTitle><span className={`local-badge ${llmMeta.enabled ? 'is-live' : ''}`}>{llmMeta.enabled ? 'LLM READY' : 'RULES'}</span></div><CardDescription>MiniMax 裁决 · 本地 RAG 证据</CardDescription></CardHeader><CardContent className="space-y-3"><div className="knowledge-stat"><span>裁决模型</span><strong>{llmMeta.enabled ? llmMeta.model : '规则回退'}</strong></div><div className="knowledge-stat"><span>知识切片</span><strong>{knowledgeMeta.documents}</strong></div><div className="knowledge-stat"><span>嵌入模型</span><strong>{knowledgeMeta.model}</strong></div></CardContent></Card>
          <div className="api-note"><MessageSquareQuote /><p><strong>模型接口已接通</strong><br />填写本地密钥即可启用 MiniMax；无密钥时安全回退为规则裁决。</p></div>
          {error && <div className="error-note"><CircleAlert /><p><strong>本地 API 暂不可用</strong><br />{error}</p></div>}
        </aside>
      </div>
    </main>
  );
}
