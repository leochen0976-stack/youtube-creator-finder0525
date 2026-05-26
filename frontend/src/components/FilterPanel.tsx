import type { FilterState } from "../types";
import { ALL_COUNTRIES } from "../constants/countries";
import { ALL_LANGUAGES } from "../constants/languages";

const VISIBLE_COUNTRY_VALUES = [
  "",
  "US",
  "GB",
  "CA",
  "AU",
  "JP",
  "KR",
  "CN",
  "TW",
  "HK",
  "SG",
  "IN",
  "ID",
  "TH",
  "VN",
  "PH",
  "BR",
  "MX",
  "DE",
  "FR",
  "ES",
  "IT",
  "PL",
  "RU",
  "ZZ"
] as const;

const VISIBLE_LANGUAGE_VALUES = [
  "",
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pl",
  "pt",
  "ru",
  "id",
  "th",
  "vi",
  "tl",
  "hi",
  "ar",
  "other"
] as const;

const visibleCountryOptions = VISIBLE_COUNTRY_VALUES.map((value) => ALL_COUNTRIES.find((country) => country.value === value)).filter(
  (country): country is (typeof ALL_COUNTRIES)[number] => Boolean(country)
);

const visibleLanguageOptions = VISIBLE_LANGUAGE_VALUES.map((value) => ALL_LANGUAGES.find((language) => language.value === value)).filter(
  (language): language is (typeof ALL_LANGUAGES)[number] => Boolean(language)
);

export const contentTypeOptions = [
  { value: "all", label: "全部", query: "" },
  { value: "video", label: "视频", query: "video" },
  { value: "short", label: "短视频", query: "shorts" },
  { value: "live", label: "直播", query: "live stream" }
] as const;

export function buildDynamicQuery(filters: FilterState): string {
  return filters.keyword.trim() || "youtube creator";
}

interface FilterPanelProps {
  filters: FilterState;
  loading: boolean;
  onChange: (next: FilterState) => void;
  onSearch: () => void;
  showSearch?: boolean;
}

export function FilterPanel({ filters, loading, onChange, onSearch, showSearch = true }: FilterPanelProps) {
  function setField<Key extends keyof FilterState>(key: Key, value: FilterState[Key]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <section className="filter-panel">
      {showSearch ? (
        <div className="filter-panel__search">
          <input
            value={filters.keyword}
            onChange={(event) => setField("keyword", event.target.value)}
            placeholder="搜索关键词（如：AI tools, productivity, tech review...）"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSearch();
              }
            }}
          />
          <button type="button" onClick={onSearch} disabled={loading}>
            {loading ? "搜索中..." : "搜索"}
          </button>
        </div>
      ) : null}

      <div className="filter-panel__grid">
        <label>
          <span>国家/地区</span>
          <select value={filters.region} onChange={(event) => setField("region", event.target.value)}>
            {visibleCountryOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>语言</span>
          <select value={filters.language} onChange={(event) => setField("language", event.target.value)}>
            {visibleLanguageOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>最小粉丝数</span>
          <input
            type="number"
            min="0"
            value={filters.subscriber_min}
            onChange={(event) => setField("subscriber_min", event.target.value)}
            placeholder="不限"
          />
        </label>

        <label>
          <span>最大粉丝数</span>
          <input
            type="number"
            min="0"
            value={filters.subscriber_max}
            onChange={(event) => setField("subscriber_max", event.target.value)}
            placeholder="不限"
          />
        </label>

        <label>
          <span>视频发布时间</span>
          <input
            type="number"
            min="0"
            value={filters.age}
            onChange={(event) => setField("age", event.target.value)}
            placeholder="不限"
          />
        </label>
      </div>
    </section>
  );
}
