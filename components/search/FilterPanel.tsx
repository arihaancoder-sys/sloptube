import Link from "next/link";
import { CloseIcon, TuneIcon } from "@/components/icons";
import { FILTER_GROUPS, isActive, resultsHref, toggleFilter, type SearchFilters } from "@/lib/search/query";

/**
 * The 2019 FILTER button and its panel: Upload date, Type, Duration and Sort
 * by as columns of links. A picked filter is dark with an X that clears it.
 * A <details> element, so it opens without any script.
 */
export function FilterPanel({ q, filters }: { q: string; filters: SearchFilters }) {
  const count = Object.keys(filters).length;
  return (
    <details className="group border-b border-divider" data-search-filters data-count={count}>
      <summary
        className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-[2px] px-2 text-[14px] font-medium uppercase tracking-[0.007px] text-text-2 hover:text-text [&::-webkit-details-marker]:hidden"
        data-search-filter-button
      >
        <TuneIcon className="h-6 w-6" />
        Filter
      </summary>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 pb-6 pt-2 search:grid-cols-4" data-search-filter-panel>
        {FILTER_GROUPS.map((group) => (
          <section key={group.key} className="min-w-0">
            <h4 className="border-b border-divider pb-3 text-[12px] font-medium uppercase leading-4 tracking-[0.3px] text-text">
              {group.label}
            </h4>
            <ul className="mt-2">
              {group.options.map((o) => {
                const on = isActive(filters, group.key, o.value);
                const removable = on && !(group.key === "sort" && o.value === "relevance");
                return (
                  <li key={o.value}>
                    <Link
                      href={resultsHref(q, toggleFilter(filters, group.key, o.value))}
                      data-search-filter={`${group.key}:${o.value}`}
                      data-on={on || undefined}
                      aria-current={on || undefined}
                      title={removable ? "Remove" : undefined}
                      className={`flex items-center gap-1 py-2 text-[14px] leading-5 ${on ? "font-medium text-text" : "text-text-2 hover:text-text"}`}
                    >
                      <span className="min-w-0">{o.label}</span>
                      {removable && <CloseIcon className="h-4 w-4 shrink-0" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
