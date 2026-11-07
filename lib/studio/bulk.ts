// The Content list's selection and bulk actions, as a reducer the tests can
// drive. The page applies a change right away, then sends it, then keeps it
// (done) or puts the rows back (failed). No imports but types.
import type { StudioRow, Visibility } from "./types.ts";
import { BULK_MAX } from "./rules.ts";

export type BulkAction =
  | { kind: "visibility"; visibility: Visibility }
  | { kind: "trash" }
  | { kind: "restore" };

export type BulkState = {
  rows: StudioRow[];
  /** Selected ids, in the order they were picked. */
  selected: string[];
  /** The change on its way, with the rows and the selection as they were before it, for a rollback. */
  pending: { action: BulkAction; ids: string[]; before: StudioRow[]; selectedBefore: string[] } | null;
  error: string | null;
};

export type BulkEvent =
  | { type: "toggle"; id: string }
  /** The header box: selects every visible row, or clears them when they all are. */
  | { type: "toggle-all"; visibleIds: string[] }
  | { type: "clear" }
  /** ids: one row's menu; left out: the selection. */
  | { type: "start"; action: BulkAction; ids?: string[] }
  | { type: "done" }
  | { type: "failed"; error: string }
  | { type: "replace"; rows: StudioRow[] };

export function initBulk(rows: StudioRow[]): BulkState {
  return { rows, selected: [], pending: null, error: null };
}

/** The ids a header box covers: is it all, some or none of them? */
export function selectionOf(selected: string[], visibleIds: string[]): "all" | "some" | "none" {
  const set = new Set(selected);
  const n = visibleIds.filter((id) => set.has(id)).length;
  return n === 0 ? "none" : n === visibleIds.length ? "all" : "some";
}

/** One row after the action. Trash rows leave the Content list (and the reverse for restore). */
function applyTo(row: StudioRow, action: BulkAction): StudioRow | null {
  switch (action.kind) {
    case "visibility":
      return row.deletedAt ? row : { ...row, visibility: action.visibility };
    case "trash":
      return row.deletedAt ? row : null;
    case "restore":
      return row.deletedAt ? null : row;
  }
}

export function bulkReducer(state: BulkState, e: BulkEvent): BulkState {
  switch (e.type) {
    case "toggle": {
      if (!state.rows.some((r) => r.id === e.id)) return state;
      const on = state.selected.includes(e.id);
      if (!on && state.selected.length >= BULK_MAX) return { ...state, error: `Pick up to ${BULK_MAX} videos at once.` };
      return { ...state, error: null, selected: on ? state.selected.filter((x) => x !== e.id) : [...state.selected, e.id] };
    }
    case "toggle-all": {
      const visible = e.visibleIds.filter((id) => state.rows.some((r) => r.id === id));
      if (selectionOf(state.selected, visible) === "all") {
        const drop = new Set(visible);
        return { ...state, error: null, selected: state.selected.filter((id) => !drop.has(id)) };
      }
      const next = [...state.selected];
      for (const id of visible) if (!next.includes(id) && next.length < BULK_MAX) next.push(id);
      return { ...state, error: null, selected: next };
    }
    case "clear":
      return { ...state, selected: [], error: null };
    case "start": {
      if (state.pending) return state;
      const ids = (e.ids ?? state.selected).filter((id) => state.rows.some((r) => r.id === id));
      if (ids.length === 0) return state;
      const pick = new Set(ids);
      const rows: StudioRow[] = [];
      for (const r of state.rows) {
        if (!pick.has(r.id)) rows.push(r);
        else {
          const next = applyTo(r, e.action);
          if (next) rows.push(next);
        }
      }
      const gone = new Set(state.rows.filter((r) => !rows.some((x) => x.id === r.id)).map((r) => r.id));
      return {
        rows,
        selected: state.selected.filter((id) => !gone.has(id)),
        pending: { action: e.action, ids, before: state.rows, selectedBefore: state.selected },
        error: null,
      };
    }
    case "done":
      return state.pending ? { ...state, pending: null } : state;
    case "failed":
      return state.pending
        ? { ...state, rows: state.pending.before, selected: state.pending.selectedBefore, pending: null, error: e.error }
        : state;
    case "replace": {
      const ids = new Set(e.rows.map((r) => r.id));
      return { ...state, rows: e.rows, selected: state.selected.filter((id) => ids.has(id)) };
    }
  }
}

/** "1 selected", "12 selected". */
export function selectedLabel(n: number): string {
  return `${n} selected`;
}

/** The note after a bulk change, like "3 videos moved to the trash". */
export function bulkDoneText(action: BulkAction, n: number): string {
  const what = n === 1 ? "1 video" : `${n} videos`;
  switch (action.kind) {
    case "visibility":
      return `${what} set to ${action.visibility}`;
    case "trash":
      return `${what} moved to the trash`;
    case "restore":
      return `${what} restored`;
  }
}
