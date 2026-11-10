import { useState } from "react";
import {
  FacetChip,
  FacetChips,
  FacetList,
  FacetOption,
  FacetSection,
  FacetStack,
  ShowMoreButton,
} from "@ehub/ui";

export interface FacetValue {
  value: string;
  label: string;
  /** Matches with the other filters applied. */
  count: number;
  imageUrl?: string;
}

const TAG_PREVIEW = 18;

/** Shows (any of) and tags (all of), with live counts. Rendered in the shared side panel. */
export function FilterPanel({
  shows,
  tags,
  selectedShows,
  selectedTags,
  onToggleShow,
  onToggleTag,
}: {
  shows: readonly FacetValue[];
  tags: readonly FacetValue[];
  selectedShows: readonly string[];
  selectedTags: readonly string[];
  onToggleShow: (show: string) => void;
  onToggleTag: (tag: string) => void;
}) {
  const [showAllTags, setShowAllTags] = useState(false);
  const visibleTags =
    showAllTags || tags.length <= TAG_PREVIEW
      ? tags
      : tags.filter((tag, i) => i < TAG_PREVIEW || selectedTags.includes(tag.value));

  return (
    <FacetStack>
      <FacetSection title="Show">
        <FacetList>
          {shows.map((show) => (
            <FacetOption
              key={show.value}
              label={show.label}
              count={show.count}
              selected={selectedShows.includes(show.value)}
              onSelect={() => onToggleShow(show.value)}
              icon={
                show.imageUrl ? (
                  <img
                    src={show.imageUrl}
                    alt=""
                    className="size-5 rounded-[4px] bg-muted object-cover"
                  />
                ) : undefined
              }
            />
          ))}
        </FacetList>
      </FacetSection>

      {tags.length > 0 ? (
        <FacetSection title="Tag">
          <FacetChips>
            {visibleTags.map((tag) => (
              <FacetChip
                key={tag.value}
                label={tag.label}
                count={tag.count}
                selected={selectedTags.includes(tag.value)}
                onSelect={() => onToggleTag(tag.value)}
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
          {selectedTags.length > 1 ? (
            <p className="mt-3 text-xs text-muted-foreground">Episodi con tutti i tag scelti.</p>
          ) : null}
        </FacetSection>
      ) : null}
    </FacetStack>
  );
}
