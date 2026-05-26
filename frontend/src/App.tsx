import { useEffect, useMemo, useState } from "react";
import { Fragment } from "react";
import { buildDynamicQuery, FilterPanel } from "./components/FilterPanel";
import {
  clearJobChannelCache,
  createJob,
  fetchJob,
  fetchJobChannels,
  fetchQuotaSummary,
  fetchSimilarCreators,
  runExport,
  runStage
} from "./lib/api";
import type {
  ChannelIntelligenceOutput,
  ChannelPageResponse,
  CreateJobInput,
  CreatorResult,
  FilterState,
  JobDetailResponse,
  QuotaSummary,
  ResultStatus,
  SimilarCreator
} from "./types";

const defaultFilters: FilterState = {
  keyword: "",
  content_type: "all",
  region: "",
  subscriber_min: "",
  subscriber_max: "",
  language: "",
  age: ""
};

type AppMode = "home" | "workspace";
type SortDirection = "asc" | "desc";
type SortKey =
  | "title"
  | "channel_title"
  | "subscribers"
  | "views"
  | "likes"
  | "comments"
  | "days_since_publish"
  | "engagement_rate"
  | "view_sub_ratio"
  | "pre_score"
  | "opportunity_tier"
  | "status";

const metricHelpText = {
  comment_rate: {
    label: "评论率",
    formula: "comments / max(views, 1)",
    meaning: "评论数占播放量的比例，越高通常说明观众更愿意表达观点。"
  },
  engagement_rate: {
    label: "互动率",
    formula: "(likes + comments * 2) / max(views, 1)",
    meaning: "综合点赞和评论的参与强度，其中评论权重更高。"
  },
  view_sub_ratio: {
    label: "播粉比",
    formula: "views / max(subscribers, 1)",
    meaning: "单条视频播放量相对于频道粉丝体量的表现。"
  },
  relative_velocity: {
    label: "相对传播速度",
    formula: "views / days_since_publish / max(subscribers, 1)",
    meaning: "考虑发布时间和账号体量后的传播效率。"
  },
  opportunity_tier: {
    label: "机会层级",
    formula: "A >= 85，B >= 70，C >= 55，D < 55",
    meaning: "按 Pre Score 分层，帮助快速判断优先关注范围。"
  },
  pre_score: {
    label: "Pre Score",
    formula:
      "30*sub_fit_score + 30*view_sub_score + 20*engagement_score + 10*comment_score + 10*relative_velocity_score",
    meaning: "基于固定规则计算的预评分，用来优先发现相对表现更强的创作者。"
  }
} as const;

const stageLabelMap = {
  created: "已创建",
  search: "候选搜索",
  enrichment: "指标补全",
  channel_intelligence: "频道情报",
  pre_score: "预评分",
  shortlist: "已生成入围",
  export: "已导出",
  done: "完成",
  failed: "失败"
} as const;

const statusLabelMap: Record<ResultStatus, string> = {
  candidate: "候选",
  enriched: "已补全",
  pre_scored: "已预评分",
  shortlisted: "已入围",
  exported: "已导出",
  rejected: "已淘汰",
  failed: "失败"
};

const SEARCH_HISTORY_STORAGE_KEY = "creatortrack.searchHistory";
const FAVORITES_STORAGE_KEY = "creatortrack.favorites";

const quickStartSteps = [
  { title: "输入关键词", description: "输入产品、行业或内容主题关键词" },
  { title: "设置筛选条件", description: "根据国家、语言、粉丝数等条件筛选" },
  { title: "查看高潜创作者", description: "发现表现优于体量的潜力创作者" },
  { title: "导出结果", description: "导出 XLSX 文件，便于团队协作" }
];

interface SearchHistoryItem {
  keyword: string;
  region: string;
  language: string;
  followers: string;
  createdAt: string;
}

interface FavoriteCreator {
  channel_id: string;
  channel_name: string;
  channel_url: string;
  avatar_url: string | null;
  country: string;
  language: string;
  subscribers: number;
}

function readStoredArray<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function formatHistoryTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "最近";
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  return `${Math.floor(diffHours / 24)} 天前`;
}

function Icon(props: { name: "search" | "history" | "star" | "export" | "trend" | "users" | "chart" | "trash" | "x"; className?: string }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3Z" />,
    export: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 19h16" /></>,
    trend: <><path d="M3 17 9 11l4 4 8-8" /><path d="M15 7h6v6" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15v-4" /><path d="M12 15V8" /><path d="M16 15v-7" /></>,
    trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 15h10l1-15" /></>,
    x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>
  } as const;

  return (
    <svg className={props.className ?? "ui-icon"} viewBox="0 0 24 24" aria-hidden="true">
      {paths[props.name]}
    </svg>
  );
}

function MetricHelp(props: { metric: keyof typeof metricHelpText; placement?: "default" | "top" }) {
  const info = metricHelpText[props.metric];
  const text = `${info.label}\n公式：${info.formula}\n意义：${info.meaning}`;

  return (
    <span
      className={`metric-help ${props.placement === "top" ? "metric-help--top" : ""}`}
      aria-label={text}
      data-tooltip={text}
      tabIndex={0}
    >
      ?
    </span>
  );
}

function normalizeAvatarUrl(url: string): string {
  return url.replace("https://yt3.ggpht.com/", "https://yt3.googleusercontent.com/");
}

function ChannelAvatar(props: {
  url?: string | null;
  label: string;
  size: "row" | "detail";
}) {
  const [failed, setFailed] = useState(false);
  const initials = props.label.slice(0, props.size === "detail" ? 2 : 1).toUpperCase() || "?";

  useEffect(() => {
    setFailed(false);
  }, [props.url]);

  if (props.url && !failed) {
    return (
      <img
        className={props.size === "detail" ? "detail-avatar-image" : "row-avatar-image"}
        src={normalizeAvatarUrl(props.url)}
        alt={props.label}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return <div className={props.size === "detail" ? "detail-avatar" : "row-avatar"}>{initials}</div>;
}

function DataPanel(props: {
  activePanel: "history" | "favorites" | null;
  searchHistory: SearchHistoryItem[];
  favorites: FavoriteCreator[];
  onClose: () => void;
  onClearHistory: () => void;
  onClearFavorites: () => void;
  onRemoveHistory: (keyword: string) => void;
  onRemoveFavorite: (channelId: string) => void;
  onRunHistory: (item: SearchHistoryItem) => void;
}) {
  if (!props.activePanel) return null;

  const isHistory = props.activePanel === "history";
  return (
    <div className="data-panel-backdrop" onClick={props.onClose}>
      <aside className="data-panel" onClick={(event) => event.stopPropagation()}>
        <header className="data-panel__header">
          <div>
            <h3>{isHistory ? "搜索历史" : "收藏夹"}</h3>
            <p>{isHistory ? "最近搜索会自动保存，可点击重新搜索。" : "收藏高潜创作者，便于后续跟进。"}</p>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>

        <div className="data-panel__body">
          {isHistory ? (
            props.searchHistory.length ? (
              props.searchHistory.map((item) => (
                <div className="panel-row" key={`${item.keyword}-${item.createdAt}`}>
                  <button type="button" className="panel-row__main" onClick={() => props.onRunHistory(item)}>
                    <Icon name="history" />
                    <span>
                      <strong>{item.keyword}</strong>
                      <em>{item.region} · {item.language} · {item.followers} · {formatHistoryTime(item.createdAt)}</em>
                    </span>
                  </button>
                  <button type="button" className="icon-button" onClick={() => props.onRemoveHistory(item.keyword)} aria-label="删除搜索记录">
                    <Icon name="trash" />
                  </button>
                </div>
              ))
            ) : (
              <div className="panel-empty">暂无搜索历史。</div>
            )
          ) : props.favorites.length ? (
            props.favorites.map((item) => (
              <div className="panel-row" key={item.channel_id}>
                <a className="panel-row__main" href={item.channel_url} target="_blank" rel="noreferrer">
                  <ChannelAvatar url={item.avatar_url} label={item.channel_name} size="row" />
                  <span>
                    <strong>{item.channel_name}</strong>
                    <em>{item.country} · {item.language} · {formatCompactNumber(item.subscribers)} 粉丝</em>
                  </span>
                </a>
                <button type="button" className="icon-button" onClick={() => props.onRemoveFavorite(item.channel_id)} aria-label="取消收藏">
                  <Icon name="trash" />
                </button>
              </div>
            ))
          ) : (
            <div className="panel-empty">还没有收藏创作者。</div>
          )}
        </div>

        <footer className="data-panel__footer">
          <button type="button" onClick={isHistory ? props.onClearHistory : props.onClearFavorites}>
            清空{isHistory ? "历史" : "收藏"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function compareValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
  direction: SortDirection
): number {
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof left === "number" || typeof right === "number") {
    const leftValue = typeof left === "number" ? left : Number.NEGATIVE_INFINITY;
    const rightValue = typeof right === "number" ? right : Number.NEGATIVE_INFINITY;
    return (leftValue - rightValue) * multiplier;
  }

  return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN") * multiplier;
}

function sortResults(results: CreatorResult[], sortKey: SortKey, sortDirection: SortDirection): CreatorResult[] {
  return [...results].sort((left, right) => {
    const compared = compareValues(left[sortKey], right[sortKey], sortDirection);
    if (compared !== 0) return compared;
    return compareValues(left.pre_score, right.pre_score, "desc");
  });
}

function summarizeActionResult(action: string, payload: unknown): string {
  const data = payload as Record<string, unknown>;

  switch (action) {
    case "run-search":
      return `候选搜索完成，新增 ${data.candidate_count ?? 0} 条结果。`;
    case "run-enrichment":
      return `指标补全完成，视频 ${data.video_metric_count ?? 0} 条，频道 ${data.channel_metric_count ?? 0} 条。`;
    case "run-pre-score":
      return `预评分完成，已计算 ${data.scored_count ?? 0} 条，跳过 ${data.skipped_count ?? 0} 条。`;
    case "run-shortlist":
      return `入围生成完成，入围 ${data.shortlisted_count ?? 0} 条，淘汰 ${data.rejected_count ?? 0} 条。`;
    default:
      return "操作已完成。";
  }
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("home");
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [jobData, setJobData] = useState<JobDetailResponse | null>(null);
  const [channelPage, setChannelPage] = useState<ChannelPageResponse | null>(null);
  const [selectedResult, setSelectedResult] = useState<CreatorResult | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelIntelligenceOutput | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<QuotaSummary | null>(null);
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [expandedSimilarId, setExpandedSimilarId] = useState<string | null>(null);
  const [similarCreators, setSimilarCreators] = useState<Record<string, SimilarCreator[]>>({});
  const [similarLoadingId, setSimilarLoadingId] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteCreator[]>([]);
  const [activePanel, setActivePanel] = useState<"history" | "favorites" | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("pre_score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  async function refreshQuotaSummary(): Promise<void> {
    try {
      const quota = await fetchQuotaSummary();
      setQuotaSummary(quota);
    } catch {
      setQuotaSummary(null);
    }
  }

  useEffect(() => {
    void refreshQuotaSummary();
  }, []);

  useEffect(() => {
    setSearchHistory(readStoredArray<SearchHistoryItem>(SEARCH_HISTORY_STORAGE_KEY));
    setFavorites(readStoredArray<FavoriteCreator>(FAVORITES_STORAGE_KEY));
  }, []);

  const channelQuery = useMemo(
    () => ({
      contentType: "all" as const,
      region: filters.region === "ZZ" ? "" : filters.region,
      language: filters.language === "other" ? "" : filters.language,
      minFollowers: filters.subscriber_min === "" ? null : Number(filters.subscriber_min),
      maxFollowers: filters.subscriber_max === "" ? null : Number(filters.subscriber_max),
      age: filters.age === "" ? null : Number(filters.age),
      page,
      pageSize,
      sortKey,
      sortDirection
    }),
    [filters.age, filters.language, filters.region, filters.subscriber_max, filters.subscriber_min, page, sortDirection, sortKey]
  );

  useEffect(() => {
    setPage(1);
  }, [filters.age, filters.language, filters.region, filters.subscriber_max, filters.subscriber_min]);

  useEffect(() => {
    if (!jobData?.job.id) {
      setChannelPage(null);
      setSelectedResult(null);
      setSelectedChannel(null);
      return;
    }

    let cancelled = false;
    setLoading((current) => (current === null ? "channels" : current));
    fetchJobChannels(jobData.job.id, channelQuery)
      .then((nextPage) => {
        if (cancelled) return;
        setChannelPage(nextPage);
        const first = nextPage.items[0] ?? null;
        setSelectedChannel((current) => nextPage.items.find((item) => item.channel_id === current?.channel_id) ?? first);
        setSelectedResult((current) => {
          const stillExists = nextPage.items.find((item) => item.representative?.id === current?.id);
          return stillExists?.representative ?? first?.representative ?? null;
        });
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "读取频道列表失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading((current) => (current === "channels" ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [channelQuery, jobData?.job.id]);

  const filteredChannels = channelPage?.items ?? [];
  const shortlistedCount = jobData?.summary?.shortlisted_count ?? 0;
  const averagePreScore = jobData?.summary?.average_pre_score ?? null;

  function handleSort(nextKey: SortKey) {
    setPage(1);
    setSortDirection((currentDirection) => {
      if (sortKey === nextKey) return currentDirection === "asc" ? "desc" : "asc";
      return nextKey === "title" || nextKey === "channel_title" || nextKey === "status" || nextKey === "opportunity_tier" ? "asc" : "desc";
    });
    setSortKey(nextKey);
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  function persistSearchHistory(nextItems: SearchHistoryItem[]) {
    setSearchHistory(nextItems);
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(nextItems));
  }

  function persistFavorites(nextItems: FavoriteCreator[]) {
    setFavorites(nextItems);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(nextItems));
  }

  function followerRangeLabel(nextFilters: FilterState): string {
    const min = nextFilters.subscriber_min || "不限";
    const max = nextFilters.subscriber_max || "不限";
    return `${min}-${max}`;
  }

  function rememberSearch(keyword: string, nextFilters: FilterState) {
    const item: SearchHistoryItem = {
      keyword,
      region: nextFilters.region || "全部国家",
      language: nextFilters.language || "全部语言",
      followers: followerRangeLabel(nextFilters),
      createdAt: new Date().toISOString()
    };
    const nextItems = [item, ...searchHistory.filter((entry) => entry.keyword.toLowerCase() !== keyword.toLowerCase())].slice(0, 12);
    persistSearchHistory(nextItems);
  }

  function removeSearchHistory(keyword: string) {
    persistSearchHistory(searchHistory.filter((entry) => entry.keyword !== keyword));
  }

  function runHistorySearch(item: SearchHistoryItem) {
    setActivePanel(null);
    void runDefaultPipeline(item.keyword);
  }

  function selectedFavoritePayload(): FavoriteCreator | null {
    if (!selectedChannel) return null;
    return {
      channel_id: selectedChannel.channel_id,
      channel_name: selectedChannel.channel_name || selectedChannel.channel_id,
      channel_url: selectedChannel.channel_url,
      avatar_url: selectedResult?.channel_avatar_url ?? null,
      country: selectedChannel.country || "Other",
      language: selectedChannel.language || "Other",
      subscribers: selectedChannel.subscriber_count
    };
  }

  function toggleSelectedFavorite() {
    const payload = selectedFavoritePayload();
    if (!payload) return;
    const exists = favorites.some((item) => item.channel_id === payload.channel_id);
    persistFavorites(exists ? favorites.filter((item) => item.channel_id !== payload.channel_id) : [payload, ...favorites]);
  }

  function removeFavorite(channelId: string) {
    persistFavorites(favorites.filter((item) => item.channel_id !== channelId));
  }

  async function refreshJob(jobId: string) {
    const detail = await fetchJob(jobId);
    setJobData(detail);
    return detail;
  }

  async function runDefaultPipeline(keywordOverride?: string) {
    const nextFilters = keywordOverride ? { ...filters, keyword: keywordOverride } : filters;
    const keyword = buildDynamicQuery(nextFilters);

    setLoading("search");
    setError(null);
    setMessage(null);

    try {
      const input: CreateJobInput = {
        keyword,
        lookback_days: nextFilters.age === "" ? 30 : Number(nextFilters.age),
        subscriber_min: nextFilters.subscriber_min === "" ? null : Number(nextFilters.subscriber_min),
        subscriber_max: nextFilters.subscriber_max === "" ? null : Number(nextFilters.subscriber_max),
        max_candidates: 50,
        shortlist_size: 50,
        minimum_pre_score: null,
        content_type: "all",
        region: "",
        language: ""
      };
      setFilters(nextFilters);
      const job = await createJob(input);
      clearJobChannelCache(job.id);
      await runStage(job.id, "run-search");
      await runStage(job.id, "run-enrichment");
      await runStage(job.id, "run-pre-score");
      await refreshJob(job.id);
      await refreshQuotaSummary();
      rememberSearch(keyword, nextFilters);
      setMode("workspace");
      setShowSearchOverlay(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "搜索失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  async function handleStage(action: "run-shortlist") {
    if (!jobData) return;
    setLoading(action);
    setError(null);
    setMessage(null);

    try {
      const payload = await runStage(jobData.job.id, action);
      clearJobChannelCache(jobData.job.id);
      await refreshJob(jobData.job.id);
      setMessage(summarizeActionResult(action, payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  async function handleExport() {
    if (!jobData) return;
    setLoading("export");
    setError(null);
    setMessage(null);

    try {
      const result = await runExport(jobData.job.id, "xlsx");
      await refreshJob(jobData.job.id);
      window.open(result.download_url, "_blank", "noopener,noreferrer");
      setMessage("XLSX 导出已生成。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  }

  async function handleToggleSimilar(resultId: string | null | undefined) {
    if (!resultId) return;
    if (expandedSimilarId === resultId) {
      setExpandedSimilarId(null);
      return;
    }

    setExpandedSimilarId(resultId);
    if (similarCreators[resultId]) return;

    setSimilarLoadingId(resultId);
    try {
      const response = await fetchSimilarCreators(resultId, 6);
      setSimilarCreators((current) => ({ ...current, [resultId]: response.items }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取相似博主失败。");
    } finally {
      setSimilarLoadingId(null);
    }
  }

  const currentStage = jobData ? stageLabelMap[jobData.job.stage] ?? jobData.job.stage : "未开始";
  const currentKeyword = jobData?.job.keyword ?? "未运行任务";
  const selectedIsFavorite = Boolean(selectedChannel && favorites.some((item) => item.channel_id === selectedChannel.channel_id));

  if (mode === "home") {
    return (
      <div className="landing-shell">
        <div className="landing-grid" />
        <div className="landing-glow landing-glow--left" />
        <div className="landing-glow landing-glow--right" />
        <div className="landing-glow landing-glow--bottom" />
        <div className="landing-particle landing-particle--one" />
        <div className="landing-particle landing-particle--two" />
        <div className="landing-particle landing-particle--three" />

        <header className="landing-nav">
          <div className="landing-brand">
            <div className="landing-brand__mark">C</div>
            <span>CreatorTrack</span>
          </div>
          <nav className="landing-nav__links" aria-label="主导航">
            <button type="button" className="landing-nav__link landing-nav__link--active">工作台</button>
            <button type="button" className="landing-nav__link" onClick={() => setActivePanel("history")}>搜索历史</button>
            <button type="button" className="landing-nav__link" onClick={() => setActivePanel("favorites")}>收藏夹</button>
          </nav>
          <div className="landing-quota">
            <span>API 配额</span>
            <strong>{quotaSummary ? `${quotaSummary.used_units.toLocaleString("zh-CN")} / ${quotaSummary.daily_limit.toLocaleString("zh-CN")}` : "-- / --"}</strong>
            <div className="landing-quota__track">
              <div className="landing-quota__bar" style={{ width: `${quotaSummary?.percent_used ?? 0}%` }} />
            </div>
            <div className="landing-user">U</div>
          </div>
        </header>

        <main className="landing-main">
          <section className="landing-hero">
            <div className="landing-copy">
              <h1>发现值得合作的 <span>YouTube</span> 创作者</h1>
              <p>基于数据洞察，找到近期表现优于体量的潜力创作者，加速品牌增长</p>
            </div>

            <section className="landing-search-card">
              <div className="landing-primary-search">
                <input
                  value={filters.keyword}
                  onChange={(event) => setFilters({ ...filters, keyword: event.target.value })}
                  placeholder="输入关键词搜索 YouTube 创作者、频道或内容主题..."
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runDefaultPipeline();
                    }
                  }}
                />
                <button type="button" onClick={() => void runDefaultPipeline()} disabled={loading === "search"}>
                  {loading === "search" ? "搜索中" : "搜索"}
                </button>
              </div>

              <FilterPanel
                filters={filters}
                loading={loading === "search"}
                onChange={setFilters}
                onSearch={() => void runDefaultPipeline()}
                showSearch={false}
              />

            </section>
            {jobData ? (
              <div className="landing-return">
                <button type="button" className="landing-return__button" onClick={() => setMode("workspace")}>
                  返回工作台
                </button>
                <div className="landing-return__text">当前保留任务：{jobData.job.keyword}</div>
              </div>
            ) : null}
            {error ? <div className="error-banner" style={{ marginTop: 18 }}>{error}</div> : null}
          </section>

          <section className="landing-bottom-grid">
            <div className="landing-card recent-card">
              <div className="landing-card__header">
                <h2>最近搜索</h2>
                <button type="button" onClick={() => setActivePanel("history")}>查看全部 ›</button>
              </div>
              <div className="recent-list">
                {(searchHistory.length ? searchHistory.slice(0, 4) : [
                  { keyword: "AI Tools Review", region: "美国", language: "English", followers: "10K-500K", createdAt: new Date().toISOString() },
                  { keyword: "Tech Channels", region: "英国", language: "English", followers: "50K-1M", createdAt: new Date().toISOString() },
                  { keyword: "Productivity Tips", region: "加拿大", language: "English", followers: "10K-500K", createdAt: new Date().toISOString() }
                ]).map((item) => (
                  <button type="button" className="recent-item" key={item.keyword} onClick={() => void runDefaultPipeline(item.keyword)}>
                    <Icon name="search" className="recent-item__icon" />
                    <strong>{item.keyword}</strong>
                    <span>{item.region}</span>
                    <span>{item.language}</span>
                    <span>{item.followers}</span>
                    <em>{formatHistoryTime(item.createdAt)}</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="landing-card quick-card">
              <h2>快速开始</h2>
              <div className="quick-list">
                {quickStartSteps.map((item, index) => (
                  <div className="quick-item" key={item.title}>
                    <span><Icon name={index === 0 ? "search" : index === 1 ? "trend" : index === 2 ? "users" : "export"} /></span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="landing-feature-row" aria-label="产品能力">
            <div><strong>精准数据洞察</strong><span>多维度数据分析</span></div>
            <div><strong>实时更新</strong><span>每日数据更新</span></div>
            <div><strong>智能评分</strong><span>Pre Score 机会评估</span></div>
            <div><strong>相似推荐</strong><span>发现更多潜力创作者</span></div>
            <div><strong>一键导出</strong><span>支持 XLSX 格式</span></div>
          </section>
        </main>
        <DataPanel
          activePanel={activePanel}
          favorites={favorites}
          searchHistory={searchHistory}
          onClearFavorites={() => persistFavorites([])}
          onClearHistory={() => persistSearchHistory([])}
          onClose={() => setActivePanel(null)}
          onRemoveFavorite={removeFavorite}
          onRemoveHistory={removeSearchHistory}
          onRunHistory={runHistorySearch}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      {showSearchOverlay ? (
        <div className="search-overlay" onClick={() => setShowSearchOverlay(false)}>
          <div className="search-overlay__panel" onClick={(event) => event.stopPropagation()}>
            <div className="search-overlay__title">新建搜索任务</div>
            <FilterPanel
              filters={filters}
              loading={loading === "search"}
              onChange={setFilters}
              onSearch={() => void runDefaultPipeline()}
            />
          </div>
        </div>
      ) : null}

      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand__logo">✦</div>
          <div>
            <div className="sidebar-brand__title">CreatorTrack</div>
            <div className="sidebar-brand__meta">创作者情报工作台</div>
          </div>
        </div>

        <div className="sidebar-task">
          <span>当前任务：</span>
          <strong>{currentKeyword}</strong>
        </div>

        <div className="workspace-header-actions">
          <button type="button" className="dashboard-action" onClick={() => setActivePanel("history")}>
            历史
          </button>
          <button type="button" className="dashboard-action" onClick={() => setActivePanel("favorites")}>
            收藏
          </button>
          <button type="button" className="sidebar-primary-button" onClick={() => setShowSearchOverlay(true)}>
            ＋ 新建搜索
          </button>
          <button type="button" className="dashboard-action dashboard-action--primary" onClick={() => void handleExport()} disabled={!jobData || loading === "export"}>
            {loading === "export" ? "导出中..." : "导出 XLSX"}
          </button>
        </div>

        <nav className="sidebar-nav">
          <button type="button" className="sidebar-link sidebar-link--active">发现中心</button>
        </nav>

        <div className="quota-panel">
          <div className="quota-panel__label">API 额度</div>
          <div className="quota-panel__value">{quotaSummary ? `${quotaSummary.used_units} / ${quotaSummary.daily_limit}` : "-- / --"}</div>
          <div className="quota-panel__progress">
            <div className="quota-panel__progress-bar" style={{ width: `${quotaSummary?.percent_used ?? 0}%` }} />
          </div>
          <div className="quota-panel__meta">
            <span>剩余 {quotaSummary ? quotaSummary.remaining_units : "--"}</span>
            <span>{quotaSummary ? `${quotaSummary.percent_used.toFixed(1)}%` : "--"}</span>
          </div>
          <div className="quota-panel__date">
            {quotaSummary ? `按太平洋时间 ${quotaSummary.usage_date} 统计` : "读取中..."}
          </div>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="top-bar">
          <button type="button" className="dashboard-action dashboard-action--primary top-bar__home-button" onClick={() => setMode("home")}>
            首页
          </button>
          <div className="top-bar__actions">
            <button type="button" className="dashboard-action" onClick={() => void handleStage("run-shortlist")} disabled={!jobData || loading === "run-shortlist"}>
              {loading === "run-shortlist" ? "生成中..." : "生成入围"}
            </button>
            <button type="button" className="dashboard-action dashboard-action--primary top-bar__export-button" onClick={() => void handleExport()} disabled={!jobData || loading === "export"}>
              {loading === "export" ? "导出中..." : "导出 XLSX"}
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          <section className="stat-grid">
            <div className="stat-panel">
              <div className="stat-label">频道总数</div>
              <div className="stat-value">{jobData?.summary?.channel_count ?? channelPage?.total ?? 0}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">已入围</div>
              <div className="stat-value">{shortlistedCount}</div>
            </div>
            <div className="stat-panel">
              <div className="stat-label">平均 Pre Score</div>
              <div className="stat-value">{averagePreScore?.toFixed(1) ?? "-"}</div>
            </div>
            <div className="stat-panel stat-panel--quota">
              <div className="stat-label">API 额度</div>
              <div className="stat-value">{quotaSummary ? `${quotaSummary.used_units} / ${quotaSummary.daily_limit}` : "-- / --"}</div>
              <div className="quota-panel__progress">
                <div className="quota-panel__progress-bar" style={{ width: `${quotaSummary?.percent_used ?? 0}%` }} />
              </div>
            </div>
          </section>

          {message ? <div className="success-banner">{message}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}

          <section className="workspace-grid">
            <section className="workspace-panel workspace-panel--table">
              <div className="workspace-panel__header">
                <div>
                  <h2>候选结果</h2>
                  <p>后端分页筛选，当前显示第 {channelPage?.page ?? page} 页，共 {channelPage?.total ?? 0} 个频道。</p>
                </div>
              </div>

              <FilterPanel
                filters={filters}
                loading={loading === "search"}
                onChange={setFilters}
                onSearch={() => void runDefaultPipeline()}
                showSearch
              />

              <div className="results-table-wrap">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th><button className="sort-button" onClick={() => handleSort("channel_title")}>频道名字{sortIndicator("channel_title")}</button></th>
                      <th><span className="table-label">频道链接</span></th>
                      <th><span className="table-label">国家</span></th>
                      <th><span className="table-label">语言</span></th>
                      <th><span className="table-label">邮箱</span></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("subscribers")}>粉丝{sortIndicator("subscribers")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("engagement_rate")}>互动率<MetricHelp metric="engagement_rate" />{sortIndicator("engagement_rate")}</button></th>
                      <th className="numeric"><button className="sort-button" onClick={() => handleSort("view_sub_ratio")}>播粉比<MetricHelp metric="view_sub_ratio" />{sortIndicator("view_sub_ratio")}</button></th>
                      <th className="centered"><button className="sort-button sort-button--accent" onClick={() => handleSort("pre_score")}>Pre Score<MetricHelp metric="pre_score" placement="top" />{sortIndicator("pre_score")}</button></th>
                      <th className="centered"><span className="table-label">相似博主</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChannels.map((channel) => {
                      const representative = channel.representative;
                      const resultId = representative?.id ?? "";
                      const isExpanded = expandedSimilarId === resultId;
                      const similar = resultId ? similarCreators[resultId] ?? [] : [];
                      return (
                      <Fragment key={channel.channel_id}>
                      <tr
                        key={channel.channel_id}
                        onClick={() => {
                          setSelectedChannel(channel);
                          setSelectedResult(representative);
                        }}
                        className={selectedChannel?.channel_id === channel.channel_id ? "selected" : undefined}
                      >
                        <td>
                          <div className="channel-cell">
                            <ChannelAvatar
                              url={representative?.channel_avatar_url}
                              label={channel.channel_name || "?"}
                              size="row"
                            />
                            <div className="channel-cell__content">
                              <div className="channel-cell__title">{channel.channel_name || "-"}</div>
                              <div className="channel-cell__meta">{channel.channel_id}</div>
                            </div>
                          </div>
                        </td>
                        <td><a href={channel.channel_url} target="_blank" rel="noreferrer">打开频道</a></td>
                        <td>{channel.country || "无"}</td>
                        <td>{channel.language || "unknown"}</td>
                        <td>{channel.email || "-"}</td>
                        <td className="numeric">{formatCompactNumber(channel.subscriber_count)}</td>
                        <td className={`numeric ${((representative?.engagement_rate ?? 0) > 0.05 ? "metric-positive" : "")}`}>{formatPercent(representative?.engagement_rate)}</td>
                        <td className={`numeric ${((representative?.view_sub_ratio ?? 0) > 0.15 ? "metric-positive" : "")}`}>{formatPercent(representative?.view_sub_ratio)}</td>
                        <td className="centered"><span className={`score-pill ${selectedChannel?.channel_id === channel.channel_id ? "score-pill--selected" : ""}`}>{representative?.pre_score?.toFixed(0) ?? "-"}</span></td>
                        <td className="centered">
                          <button
                            type="button"
                            className="table-inline-button"
                            disabled={!resultId || similarLoadingId === resultId}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleToggleSimilar(resultId);
                            }}
                          >
                            {similarLoadingId === resultId ? "读取中..." : isExpanded ? "收起推荐" : "查看相似博主"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="similar-row">
                          <td colSpan={10}>
                            <div className="similar-panel">
                              {similarLoadingId === resultId ? (
                                <div className="similar-empty">正在匹配相似博主...</div>
                              ) : similar.length ? (
                                similar.map((item) => (
                                  <div className="similar-card" key={item.channel_id}>
                                    <div className="similar-card__identity">
                                      <ChannelAvatar
                                        url={item.channel_avatar_url}
                                        label={item.channel_name || item.channel_id || "相似博主"}
                                        size="row"
                                      />
                                      <div className="similar-card__main">
                                        <div className="similar-card__title">{item.channel_name || item.channel_id}</div>
                                        <div className="similar-card__meta">
                                          {item.country} · {item.language} · {formatCompactNumber(item.subscriber_count)} 粉丝
                                        </div>
                                        <div className="similar-card__meta">
                                          {item.game_category || "unknown"} · Similarity {item.similarity_score.toFixed(1)}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="similar-card__actions">
                                      <a href={item.channel_url} target="_blank" rel="noreferrer">打开频道</a>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void runDefaultPipeline(item.channel_name || item.game_category);
                                        }}
                                      >
                                        再次搜索
                                      </button>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="similar-empty">暂无足够相似的本地候选。</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pagination-bar">
                <button
                  type="button"
                  className="dashboard-action"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || loading === "channels"}
                >
                  上一页
                </button>
                <span>
                  第 {page} / {Math.max(1, Math.ceil((channelPage?.total ?? 0) / pageSize))} 页
                </span>
                <button
                  type="button"
                  className="dashboard-action"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={loading === "channels" || page >= Math.max(1, Math.ceil((channelPage?.total ?? 0) / pageSize))}
                >
                  下一页
                </button>
              </div>
            </section>

            <aside className="workspace-panel workspace-panel--detail">
              <div className="detail-panel-header">
                <span>频道详情</span>
                <div className="detail-panel-header__actions">
                  <span>Ⅱ</span>
                  <span>×</span>
                </div>
              </div>
              {selectedChannel ? (
                <>
                  <div className="detail-cover">
                    <div className="detail-cover__overlay" />
                    <div className="detail-cover__content">
                      <ChannelAvatar
                        url={selectedResult?.channel_avatar_url}
                        label={selectedChannel.channel_name || "频道头像"}
                        size="detail"
                      />
                      <div>
                        <h3>{selectedChannel.channel_name || "未命名频道"}</h3>
                        <a href={selectedChannel.channel_url} target="_blank" rel="noreferrer">{selectedChannel.channel_url.replace("https://www.", "")}</a>
                        <button type="button" className="favorite-toggle" onClick={toggleSelectedFavorite}>
                          <Icon name="star" />
                          {selectedIsFavorite ? "已收藏" : "收藏创作者"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="detail-body">
                    <section className="detail-section">
                      <h4>基础指标</h4>
                      <div className="metric-grid">
                        <div className="metric-card"><span>粉丝数</span><strong>{formatCompactNumber(selectedChannel.subscriber_count)}</strong></div>
                        <div className="metric-card"><span>视频数</span><strong>{formatCompactNumber(selectedChannel.video_count)}</strong></div>
                        <div className="metric-card"><span>语言</span><strong>{selectedChannel.language || "unknown"}</strong></div>
                        <div className="metric-card"><span>邮箱</span><strong>{selectedChannel.email || "-"}</strong></div>
                      </div>
                    </section>

                    <section className="detail-section">
                      <h4>表现指标</h4>
                      <div className="detail-list">
                        <div className="detail-list__item"><span>互动率<MetricHelp metric="engagement_rate" /></span><strong className="metric-positive">{formatPercent(selectedResult?.engagement_rate)}</strong></div>
                        <div className="detail-list__item"><span>评论率<MetricHelp metric="comment_rate" /></span><strong>{formatPercent(selectedResult?.comment_rate)}</strong></div>
                        <div className="detail-list__item"><span>播粉比<MetricHelp metric="view_sub_ratio" /></span><strong className="metric-positive">{formatPercent(selectedResult?.view_sub_ratio)}</strong></div>
                        <div className="detail-list__item"><span>相对传播速度<MetricHelp metric="relative_velocity" /></span><strong>{selectedResult?.relative_velocity?.toFixed(3) ?? "-"}</strong></div>
                      </div>
                    </section>

                    <section className="detail-section">
                      <h4>状态信息</h4>
                      <div className="detail-list">
                        <div className="detail-list__item"><span>发布时间</span><strong>{selectedResult?.published_at ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>发布天数</span><strong>{selectedResult?.days_since_publish ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>Pre Score<MetricHelp metric="pre_score" placement="top" /></span><strong>{selectedResult?.pre_score?.toFixed(2) ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>机会层级<MetricHelp metric="opportunity_tier" /></span><strong>{selectedResult?.opportunity_tier ?? "-"}</strong></div>
                        <div className="detail-list__item"><span>国家</span><strong>{selectedChannel.country || "无"}</strong></div>
                        <div className="detail-list__item"><span>状态</span><strong>{selectedResult ? statusLabelMap[selectedResult.status] ?? selectedResult.status : "-"}</strong></div>
                      </div>
                    </section>

                    <section className="detail-section">
                      <h4>频道情报</h4>
                      <div className="detail-list">
                        <div className="detail-list__item"><span>描述</span><strong>{selectedChannel.description || "-"}</strong></div>
                        <div className="detail-list__item"><span>相似频道</span><strong>{selectedChannel.similar_channels.map((item) => item.channel_name || item.channel_id).join("，") || "-"}</strong></div>
                      </div>
                    </section>
                  </div>
                </>
              ) : (
                <div className="detail-empty">
                  <h3>暂无详情</h3>
                  <p>先运行一次搜索，然后从左侧结果表中选择一条记录。</p>
                </div>
              )}
            </aside>
          </section>
        </main>
      </div>
      <DataPanel
        activePanel={activePanel}
        favorites={favorites}
        searchHistory={searchHistory}
        onClearFavorites={() => persistFavorites([])}
        onClearHistory={() => persistSearchHistory([])}
        onClose={() => setActivePanel(null)}
        onRemoveFavorite={removeFavorite}
        onRemoveHistory={removeSearchHistory}
        onRunHistory={runHistorySearch}
      />
    </div>
  );
}
