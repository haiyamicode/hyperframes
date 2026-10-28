import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "../../icons/SystemIcons";
import { menuClasses } from "../../components/ui/menuStyle";
import { getPortalRoot } from "../../components/ui/portalRoot";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { trackDisplaySuffix } from "./timelineTrackDisplay";

const VIEWPORT_MARGIN = 8;

/**
 * A track header's ⋯: rename the track, or delete it with its clips. Renders nothing when the host
 * offers neither. Display number in the text, real key in the callbacks (as `VisibilityButton`).
 */
export function TrackMenuButton({
  trackNumber,
  trackDisplayNumber,
  trackName,
  onRenameTrack,
  onDeleteTrack,
}: {
  trackNumber: number;
  trackDisplayNumber: number | null;
  /** What the header calls the track: the rename starts from it. */
  trackName: string;
  onRenameTrack: TimelineEditCallbacks["onRenameTrack"];
  onDeleteTrack: TimelineEditCallbacks["onDeleteTrack"];
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (!onRenameTrack && !onDeleteTrack) return null;
  const label = `Track${trackDisplaySuffix(trackDisplayNumber)} options`;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-[var(--timeline-text-faint)] transition-colors hover:text-[var(--timeline-text-soft)] focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--timeline-accent)]"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <MoreHorizontal size={14} weight="bold" />
      </button>
      {anchor && (
        <TrackMenu
          x={anchor.x}
          y={anchor.y}
          trackName={trackName}
          onRename={onRenameTrack && ((name) => void onRenameTrack(trackNumber, name))}
          onDelete={onDeleteTrack && (() => void onDeleteTrack(trackNumber))}
          onClose={close}
        />
      )}
    </>
  );
}

/** The arrows step focus through the menu's items, wrapping at the ends. */
function moveMenuFocus(event: KeyboardEvent, menu: HTMLElement | null): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.findIndex((item) => item === document.activeElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  items[(at + step + items.length) % items.length].focus();
}

function TrackMenu({
  x,
  y,
  trackName,
  onRename,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  trackName: string;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [renaming, setRenaming] = useState(false);

  // Clamp the panel inside the viewport once it has a size.
  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      x: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
      y: Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN),
    });
  }, [x, y, renaming]);

  // Escape backs out one level (rename → menu → closed); the arrows move between items.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        if (!renaming) moveMenuFocus(event, menuRef.current);
        return;
      }
      event.stopPropagation();
      if (renaming) setRenaming(false);
      else onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [renaming, onClose]);

  const rename = (name: string) => {
    if (name && name !== trackName) onRename?.(name);
    onClose();
  };

  // Portalled out of the timeline, but React still bubbles its events through the header: stop
  // them here, so a press or a key in the menu never reaches the timeline's own handlers.
  return createPortal(
    <div
      className="fixed inset-0 z-200"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${trackName} options`}
        className={`${menuClasses.panel} absolute min-w-[160px] text-xs`}
        style={{ left: pos.x, top: pos.y }}
        onClick={(event) => event.stopPropagation()}
      >
        {renaming ? (
          <TrackRenameForm
            trackName={trackName}
            onRename={rename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <TrackMenuItems
            onRename={onRename && (() => setRenaming(true))}
            onDelete={
              onDelete &&
              (() => {
                onDelete();
                onClose();
              })
            }
          />
        )}
      </div>
    </div>,
    getPortalRoot(),
  );
}

/** The menu's rows; the first takes focus when they show, so the arrows work at once. */
function TrackMenuItems({ onRename, onDelete }: { onRename?: () => void; onDelete?: () => void }) {
  return (
    <>
      {onRename && (
        <button
          type="button"
          role="menuitem"
          autoFocus
          className={`${menuClasses.row} ${menuClasses.rowEnabled} transition-colors`}
          onClick={onRename}
        >
          Rename
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          role="menuitem"
          autoFocus={!onRename}
          className={`${menuClasses.row} ${menuClasses.rowDanger} transition-colors`}
          onClick={onDelete}
        >
          Delete track
        </button>
      )}
    </>
  );
}

function TrackRenameForm({
  trackName,
  onRename,
  onCancel,
}: {
  trackName: string;
  /** Gets the trimmed draft. */
  onRename: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(trackName);
  const commit = () => onRename(draft.trim());
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5">
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        aria-label={`Rename ${trackName}`}
        className="w-full rounded-sm border border-neutral-600 bg-neutral-800 px-1.5 py-1 text-[11px] text-text-0 focus:border-studio-accent/60 focus:outline-hidden"
      />
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:text-neutral-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={commit}
          className="rounded-sm bg-accent px-2 py-0.5 text-[10px] text-on-accent transition-colors hover:bg-accent-hover"
        >
          Rename
        </button>
      </div>
    </div>
  );
}
