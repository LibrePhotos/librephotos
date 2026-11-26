import {
  IconCheck,
  IconPencil,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "../../ui/IconButton";
import "./Edit.css";
import { shortcut } from "../../platform";

const STARS = [1, 2, 3, 4, 5] as const;

export function RatingStars({
  rating,
  onRate,
  disabled,
  size = 20,
}: {
  rating: number;
  onRate(rating: number): void;
  disabled?: boolean;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? rating;
  return (
    <div className="rating-stars" role="radiogroup" aria-label="Rating" onPointerLeave={() => setHover(null)}>
      {STARS.map(n => {
        const I = n <= shown ? IconStarFilled : IconStar;
        const label = n === rating ? "Clear rating" : `Rate ${n} star${n === 1 ? "" : "s"}`;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === rating}
            aria-label={label}
            data-tip={`${label}  ${shortcut(String(n === rating ? 0 : n))}`}
            className={`rating-star${n <= shown ? " on" : ""}`}
            disabled={disabled}
            onPointerEnter={() => setHover(n)}
            onClick={() => onRate(n)}
          >
            <I size={size} stroke={1.75} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function EditHeader({
  title,
  editing,
  editLabel,
  onEdit,
  onCancel,
  onSave,
  saveDisabled,
  icon = IconPencil,
}: {
  title: string;
  editing: boolean;
  editLabel: string;
  onEdit(): void;
  onCancel(): void;
  onSave(): void;
  saveDisabled?: boolean;
  icon?: Icon;
}) {
  return (
    <div className="edit-head">
      <h3 className="section-title">{title}</h3>
      {editing ? (
        <div className="edit-head-actions">
          <IconButton icon={IconX} label="Cancel" size="sm" onClick={onCancel} tipEnd />
          <IconButton icon={IconCheck} label="Save" size="sm" onClick={onSave} disabled={saveDisabled} tipEnd />
        </div>
      ) : (
        <IconButton icon={icon} label={editLabel} size="sm" onClick={onEdit} tipEnd />
      )}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="edit-add" onClick={onClick}>
      <IconPlus size={14} stroke={1.75} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function CaptionSection({ caption, onSave }: { caption: string; onSave(caption: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const save = () => {
    if (draft === null) return;
    if (draft.trim() !== caption.trim()) onSave(draft.trim());
    setDraft(null);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };
  return (
    <section className="section" aria-label="Caption">
      <EditHeader
        title="Caption"
        editing={editing}
        editLabel="Edit caption"
        onEdit={() => setDraft(caption)}
        onCancel={() => setDraft(null)}
        onSave={save}
      />
      {editing ? (
        <textarea
          className="field-input edit-textarea"
          aria-label="Caption"
          placeholder="Describe this picture"
          value={draft}
          autoFocus
          rows={3}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
      ) : caption ? (
        <p className="edit-caption" data-testid="caption-text">
          {caption}
        </p>
      ) : (
        <AddButton label="Add a caption" onClick={() => setDraft("")} />
      )}
    </section>
  );
}

function splitWords(text: string): string[] {
  return text
    .split(",")
    .map(w => w.trim())
    .filter(w => w.length > 0);
}

function withKeywords(list: string[], added: string[]): string[] {
  const out = [...list];
  for (const word of added) {
    if (!out.some(k => k.toLowerCase() === word.toLowerCase())) out.push(word);
  }
  return out;
}

export function KeywordsSection({ keywords, onSave }: { keywords: string[]; onSave(keywords: string[]): void }) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const pending = () => withKeywords(draft ?? keywords, splitWords(text));
  const save = () => {
    const next = pending();
    const changed = next.length !== keywords.length || next.some((k, i) => k !== keywords[i]);
    if (changed) onSave(next);
    setDraft(null);
    setText("");
  };
  const cancel = () => {
    setDraft(null);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (text.trim() === "" && e.key === "Enter") save();
      else {
        setDraft(pending());
        setText("");
      }
    } else if (e.key === "Backspace" && text === "" && draft && draft.length > 0) {
      setDraft(draft.slice(0, -1));
    }
  };
  const list = draft ?? keywords;
  return (
    <section className="section" aria-label="Keywords">
      <EditHeader
        title="Keywords"
        editing={editing}
        editLabel="Edit keywords"
        onEdit={() => setDraft(keywords)}
        onCancel={cancel}
        onSave={save}
      />
      {list.length > 0 || editing ? (
        <div className={`keyword-list${editing ? " editing" : ""}`} data-testid="keyword-list">
          {list.map(k => (
            <span key={k.toLowerCase()} className="keyword-pill">
              <span>{k}</span>
              {editing && (
                <button
                  type="button"
                  className="keyword-remove"
                  aria-label={`Remove ${k}`}
                  onClick={() => setDraft(list.filter(x => x !== k))}
                >
                  <IconX size={12} stroke={2} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          {editing && (
            <input
              ref={input}
              className="keyword-input"
              aria-label="Add a keyword"
              placeholder={list.length === 0 ? "Add keywords, then Enter" : "Add"}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={onKey}
            />
          )}
        </div>
      ) : (
        <AddButton label="Add keywords" onClick={() => setDraft([])} />
      )}
    </section>
  );
}

export function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 19) : "";
}

export function fromDateInput(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(value);
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3] ?? ":00"}`;
}

export function DateEditor({
  takenAt,
  onSave,
  onCancel,
}: {
  takenAt: string | null;
  onSave(takenAt: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(toDateInput(takenAt));
  const parsed = fromDateInput(value);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && parsed) {
      e.preventDefault();
      onSave(parsed);
    }
  };
  return (
    <div className="date-editor">
      <input
        type="datetime-local"
        step={1}
        className="field-input"
        aria-label="Date taken"
        value={value}
        autoFocus
        onChange={e => setValue(e.target.value)}
        onKeyDown={onKey}
      />
      <IconButton icon={IconX} label="Cancel" size="sm" onClick={onCancel} tipEnd />
      <IconButton icon={IconCheck} label="Save" size="sm" disabled={!parsed} onClick={() => parsed && onSave(parsed)} tipEnd />
    </div>
  );
}

export function InlineEdit({ children, label, onEdit }: { children: ReactNode; label: string; onEdit(): void }) {
  return (
    <span className="inline-edit">
      {children}
      <IconButton icon={IconPencil} label={label} size="sm" onClick={onEdit} tipEnd />
    </span>
  );
}
