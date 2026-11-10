import { useState } from "react";
import { STATUS_LABELS } from "@shared/labels";
import type { SiteIndex } from "@shared/schema";
import {
  FacetChip,
  FacetChips,
  FacetList,
  FacetOption,
  FacetSection,
  FacetStack,
  ShowMoreButton,
} from "@ehub/ui";
import { StatusDot } from "@library/components/status-badge";
import {
  type Facets,
  type LibraryQuery,
  STATUS_ORDER,
  toggleTag,
  toggleValue,
} from "@library/lib/library-query";

const TAG_PREVIEW = 18;

/** Topic (single), status (any of) and tags (all of), with live counts. Rendered in the shared side panel. */
export function FilterPanel({
  index,
  query,
  facets,
  onChange,
}: {
  index: SiteIndex;
  query: LibraryQuery;
  facets: Facets;
  onChange: (next: LibraryQuery) => void;
}) {
  const [showAllTags, setShowAllTags] = useState(false);
  const usedTopics = new Set(index.books.map((b) => b.topic));
  const topics = index.topics.filter((t) => usedTopics.has(t.id) || t.id === query.topic);
  const tags = facets.tags;
  const visibleTags =
    showAllTags || tags.length <= TAG_PREVIEW
      ? tags
      : tags.filter((t, i) => i < TAG_PREVIEW || t.selected);

  return (
    <FacetStack>
      <FacetSection title="Argomento">
        <FacetList>
          <FacetOption
            kind="single"
            label="Tutti gli argomenti"
            count={facets.topicTotal}
            selected={query.topic === null}
            onSelect={() => onChange({ ...query, topic: null })}
          />
          {topics.map((topic) => {
            const active = query.topic === topic.id;
            return (
              <FacetOption
                key={topic.id}
                kind="single"
                label={topic.label}
                count={facets.topics.get(topic.id) ?? 0}
                selected={active}
                onSelect={() => onChange({ ...query, topic: active ? null : topic.id })}
              />
            );
          })}
        </FacetList>
      </FacetSection>

      <FacetSection title="Stato">
        <FacetList>
          {STATUS_ORDER.map((status) => (
            <FacetOption
              key={status}
              label={STATUS_LABELS[status]}
              icon={<StatusDot status={status} />}
              count={facets.statuses.get(status) ?? 0}
              selected={query.statuses.includes(status)}
              onSelect={() => onChange({ ...query, statuses: toggleValue(query.statuses, status) })}
            />
          ))}
        </FacetList>
      </FacetSection>

      {tags.length > 0 ? (
        <FacetSection title="Tag">
          <FacetChips>
            {visibleTags.map((tag) => (
              <FacetChip
                key={tag.key}
                label={tag.label}
                count={tag.count}
                selected={tag.selected}
                onSelect={() => onChange({ ...query, tags: toggleTag(query.tags, tag.label) })}
              />
            ))}
          </FacetChips>
          {tags.length > TAG_PREVIEW ? (
            <ShowMoreButton
              noun="tag"
              total={tags.length}
              expanded={showAllTags}
              onToggle={() => setShowAllTags((v) => !v)}
            />
          ) : null}
        </FacetSection>
      ) : null}
    </FacetStack>
  );
}
