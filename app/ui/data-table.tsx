'use client';

import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from './button';
import { Skeleton } from './skeleton';
import { cx } from './util';

export type SortDir = 'asc' | 'desc';
export type SortState = { key: string; dir: SortDir };

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  /** Cell renderer; defaults to `row[key]`. */
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  /** Value used for client-side sorting; defaults to `row[key]`. */
  sortValue?: (row: T) => string | number | boolean | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Muted text color for the cell. */
  muted?: boolean;
  className?: string;
  /**
   * Where the column appears in the phone card layout:
   * title (first line), subtitle (under the title), trailing (top-right), meta (2-col grid), hidden.
   * Default: first column = title, the next 4 = meta, others hidden.
   */
  mobile?: 'title' | 'subtitle' | 'trailing' | 'meta' | 'hidden';
  /** Label used in the mobile meta grid (defaults to header when it is a string). */
  mobileLabel?: string;
};

export type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Navigate on row click. */
  rowHref?: (row: T) => string;
  selectable?: boolean;
  /** Controlled selection (ids). */
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** Rendered in the bulk bar when rows are selected. */
  bulkActions?: (ids: string[], clear: () => void) => ReactNode;
  /** Controlled sort. When `onSortChange` is set, rows are NOT sorted locally (server sort). */
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  defaultSort?: SortState;
  loading?: boolean;
  /** Shown when there are no rows (and not loading). */
  empty?: ReactNode;
  /** Custom phone card renderer. */
  mobileCard?: (row: T) => ReactNode;
  /** Rendered below the table (e.g. a "Load more" button). */
  footer?: ReactNode;
  className?: string;
  'aria-label'?: string;
};

function defaultRowId(row: unknown): string {
  const id = (row as { id?: unknown })?.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : JSON.stringify(row);
}

function rawValue<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function display(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="subtle">—</span>;
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isInteractive(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('a, button, input, select, textarea, label, [role="menu"], [data-no-row-click]');
}

export function DataTable<T>({
  rows,
  columns,
  getRowId = defaultRowId,
  onRowClick,
  rowHref,
  selectable,
  selected: selectedProp,
  onSelectedChange,
  bulkActions,
  sort: sortProp,
  onSortChange,
  defaultSort,
  loading,
  empty,
  mobileCard,
  footer,
  className,
  ...aria
}: DataTableProps<T>) {
  const router = useRouter();
  const [localSort, setLocalSort] = useState<SortState | null>(defaultSort ?? null);
  const sort = sortProp !== undefined ? sortProp : localSort;
  const [localSelected, setLocalSelected] = useState<string[]>([]);
  const selected = selectedProp ?? localSelected;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const lastIndex = useRef<number | null>(null);
  const headerCheck = useRef<HTMLInputElement>(null);

  const setSelected = (ids: string[]) => {
    if (selectedProp === undefined) setLocalSelected(ids);
    onSelectedChange?.(ids);
  };

  const sortedRows = useMemo(() => {
    if (!sort || onSortChange) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sortValue ?? ((row: T) => rawValue(row, col.key) as string | number | null);
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null || av === '') return 1;
      if (bv == null || bv === '') return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * factor;
    });
  }, [rows, columns, sort, onSortChange]);

  const ids = useMemo(() => sortedRows.map(getRowId), [sortedRows, getRowId]);
  const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));
  const someSelected = !allSelected && ids.some((id) => selectedSet.has(id));

  useEffect(() => {
    if (headerCheck.current) headerCheck.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleSort = (key: string) => {
    const next: SortState = sort?.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
    if (onSortChange) onSortChange(next);
    if (sortProp === undefined) setLocalSort(next);
  };

  const toggleRow = (id: string, index: number, shift: boolean) => {
    const next = new Set(selectedSet);
    const turnOn = !next.has(id);
    if (shift && lastIndex.current !== null) {
      const [from, to] = [Math.min(lastIndex.current, index), Math.max(lastIndex.current, index)];
      for (let i = from; i <= to; i += 1) {
        if (turnOn) next.add(ids[i]);
        else next.delete(ids[i]);
      }
    } else if (turnOn) next.add(id);
    else next.delete(id);
    lastIndex.current = index;
    setSelected(Array.from(next));
  };

  const toggleAll = () => setSelected(allSelected ? selected.filter((id) => !ids.includes(id)) : Array.from(new Set([...selected, ...ids])));

  const clickable = !!(onRowClick || rowHref);
  const activate = (row: T, event?: MouseEvent) => {
    if (onRowClick) return onRowClick(row);
    if (rowHref) {
      const href = rowHref(row);
      if (event && (event.metaKey || event.ctrlKey)) window.open(href, '_blank');
      else router.push(href);
    }
  };
  const onRowClickEvent = (row: T) => (event: MouseEvent) => {
    if (isInteractive(event.target)) return;
    if (window.getSelection()?.toString()) return;
    activate(row, event);
  };
  const onRowKey = (row: T) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !isInteractive(event.target)) activate(row);
  };

  // Mobile layout mapping
  const mobileCols = useMemo(() => {
    let metaCount = 0;
    return columns.map((c, i) => {
      if (c.mobile) return c.mobile;
      if (i === 0) return 'title';
      metaCount += 1;
      return metaCount <= 4 ? 'meta' : 'hidden';
    });
  }, [columns]);

  const renderCell = (col: DataTableColumn<T>, row: T) => (col.cell ? col.cell(row) : display(rawValue(row, col.key)));
  const showEmpty = !loading && sortedRows.length === 0;

  return (
    <div className={cx('ui-dt', className)}>
      {selectable && selected.length > 0 && (
        <div className="ui-dt__bulk" role="region" aria-label="Bulk actions">
          <span className="ui-dt__bulk-count">{selected.length} selected</span>
          <div className="ui-dt__bulk-actions">{bulkActions?.(selected, () => setSelected([]))}</div>
          <IconButton icon={X} size="sm" label="Clear selection" onClick={() => setSelected([])} />
        </div>
      )}

      {showEmpty ? (
        empty ?? null
      ) : (
        <>
          <div className="ui-dt__scroll">
            <table className="ui-dt__table" aria-label={aria['aria-label']} aria-busy={loading || undefined}>
              <thead>
                <tr>
                  {selectable && (
                    <th className="ui-dt__checkcell">
                      <input ref={headerCheck} type="checkbox" className="ui-check" aria-label="Select all rows" checked={allSelected} onChange={toggleAll} />
                    </th>
                  )}
                  {columns.map((col) => {
                    const sorted = sort?.key === col.key ? sort.dir : undefined;
                    return (
                      <th
                        key={col.key}
                        style={{ width: col.width }}
                        className={cx(col.align === 'right' && 'ui-dt__align-right', col.align === 'center' && 'ui-dt__align-center')}
                        aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        {col.sortable ? (
                          <button type="button" className="ui-dt__th-btn" data-sorted={sorted} onClick={() => toggleSort(col.key)}>
                            {col.header}
                            {sorted === 'asc' ? <ArrowUp aria-hidden /> : sorted === 'desc' ? <ArrowDown aria-hidden /> : <ChevronsUpDown aria-hidden />}
                          </button>
                        ) : (
                          col.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading && sortedRows.length === 0
                  ? Array.from({ length: 6 }, (_, i) => (
                      <tr key={`sk-${i}`}>
                        {selectable && <td className="ui-dt__checkcell" />}
                        {columns.map((col, j) => (
                          <td key={col.key}>
                            <Skeleton width={j === 0 ? '70%' : '50%'} height={12} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : sortedRows.map((row, index) => {
                      const id = ids[index];
                      const isSel = selectedSet.has(id);
                      return (
                        <tr
                          key={id}
                          className={cx(clickable && 'ui-dt__row--click', isSel && 'ui-dt__row--selected')}
                          onClick={clickable ? onRowClickEvent(row) : undefined}
                          onKeyDown={clickable ? onRowKey(row) : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          aria-selected={selectable ? isSel : undefined}
                        >
                          {selectable && (
                            <td className="ui-dt__checkcell">
                              <input
                                type="checkbox"
                                className="ui-check"
                                aria-label="Select row"
                                checked={isSel}
                                onChange={() => undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRow(id, index, e.shiftKey);
                                }}
                              />
                            </td>
                          )}
                          {columns.map((col) => (
                            <td
                              key={col.key}
                              className={cx(col.align === 'right' && 'ui-dt__align-right', col.align === 'center' && 'ui-dt__align-center', col.muted && 'ui-dt__muted', col.className)}
                            >
                              {renderCell(col, row)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>

          <div className="ui-dt__cards" aria-label={aria['aria-label']} role="list">
            {loading && sortedRows.length === 0
              ? Array.from({ length: 4 }, (_, i) => (
                  <div key={`skm-${i}`} className="ui-dt__card" role="listitem">
                    <div className="ui-dt__card-body">
                      <Skeleton width="60%" height={14} />
                      <Skeleton lines={2} height={10} />
                    </div>
                  </div>
                ))
              : sortedRows.map((row, index) => {
                  const id = ids[index];
                  const isSel = selectedSet.has(id);
                  const titleCols = columns.filter((_, i) => mobileCols[i] === 'title');
                  const subCols = columns.filter((_, i) => mobileCols[i] === 'subtitle');
                  const trailCols = columns.filter((_, i) => mobileCols[i] === 'trailing');
                  const metaCols = columns.filter((_, i) => mobileCols[i] === 'meta');
                  return (
                    <div
                      key={id}
                      role="listitem"
                      className={cx('ui-dt__card', clickable && 'ui-dt__card--click', isSel && 'ui-dt__card--selected')}
                      onClick={clickable ? onRowClickEvent(row) : undefined}
                      onKeyDown={clickable ? onRowKey(row) : undefined}
                      tabIndex={clickable ? 0 : undefined}
                    >
                      {selectable && (
                        <label className="ui-dt__card-check" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="ui-check"
                            aria-label="Select"
                            checked={isSel}
                            onChange={() => toggleRow(id, index, false)}
                          />
                        </label>
                      )}
                      {mobileCard ? (
                        <div className="ui-dt__card-body">{mobileCard(row)}</div>
                      ) : (
                        <div className="ui-dt__card-body">
                          <div className="row-between" style={{ alignItems: 'flex-start' }}>
                            <div className="grow stack-sm" style={{ gap: 3 }}>
                              {titleCols.map((col) => (
                                <div key={col.key} className="ui-dt__card-title">
                                  {renderCell(col, row)}
                                </div>
                              ))}
                              {subCols.map((col) => (
                                <div key={col.key} className="text-sm muted">
                                  {renderCell(col, row)}
                                </div>
                              ))}
                            </div>
                            {trailCols.length > 0 && (
                              <div className="row" style={{ flex: 'none' }}>
                                {trailCols.map((col) => (
                                  <span key={col.key}>{renderCell(col, row)}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          {metaCols.length > 0 && (
                            <dl className="ui-dt__card-meta">
                              {metaCols.map((col) => (
                                <div key={col.key} style={{ minWidth: 0 }}>
                                  <dt>{col.mobileLabel ?? (typeof col.header === 'string' ? col.header : col.key)}</dt>
                                  <dd>{renderCell(col, row)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                      )}
                      {clickable && !mobileCard && <ChevronRight className="ui-dt__card-chev" aria-hidden />}
                    </div>
                  );
                })}
          </div>
          {footer && <div className="ui-dt__footer">{footer}</div>}
        </>
      )}
    </div>
  );
}
