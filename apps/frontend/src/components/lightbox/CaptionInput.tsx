import { Combobox, useCombobox } from "@mantine/core";
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./CaptionInput.module.css";
import { hashtagRuns } from "./captionMarkup";
import { hashtagAtCaret, hashtagSuggestions, insertHashtag, type HashtagAtCaret } from "./captionSuggestions";

export type CaptionInputProps = Readonly<{
  initialCaption: string;
  editable: boolean;
  hashtags: readonly string[];
  onChange: (caption: string) => void;
}>;

function Highlighted({ text }: Readonly<{ text: string }>) {
  return hashtagRuns(text).map(run =>
    run.hashtag ? (
      <mark key={run.start} className={classes.hashtag}>
        {run.text}
      </mark>
    ) : (
      <React.Fragment key={run.start}>{run.text}</React.Fragment>
    )
  );
}

const sameHashtag = (a: HashtagAtCaret | null, b: HashtagAtCaret | null) =>
  a !== null && b !== null && a.start === b.start && a.query === b.query;

const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

export function CaptionInput({ initialCaption, editable, hashtags, onChange }: CaptionInputProps) {
  const { t } = useTranslation();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const caretAfterRender = useRef<number | null>(null);
  const listId = useId();
  const [text, setText] = useState(initialCaption);
  const [hashtag, setHashtag] = useState<HashtagAtCaret | null>(null);
  const [dismissed, setDismissed] = useState<HashtagAtCaret | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const opened = hashtag !== null && !sameHashtag(hashtag, dismissed);
  const suggestions = hashtag && opened ? hashtagSuggestions(hashtags, hashtag.query) : [];
  const dismiss = () => setDismissed(hashtag);
  const combobox = useCombobox({
    opened,
    onOpenedChange: open => {
      if (!open) dismiss();
    },
  });

  useEffect(() => {
    const element = textarea.current;
    if (!editable || !element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editable]);

  useLayoutEffect(() => {
    const caret = caretAfterRender.current;
    if (caret === null) return;
    caretAfterRender.current = null;
    textarea.current?.setSelectionRange(caret, caret);
  }, [text]);

  const followCaret = (element: HTMLTextAreaElement) => {
    const next =
      element.selectionStart === element.selectionEnd ? hashtagAtCaret(element.value, element.selectionStart) : null;
    if (!sameHashtag(next, hashtag)) setHighlighted(0);
    setHashtag(next);
  };

  const update = (next: string) => {
    setText(next);
    onChange(next);
  };

  const accept = (suggestion: string) => {
    if (!hashtag) return;
    const next = insertHashtag(text, hashtag, suggestion);
    caretAfterRender.current = next.caret;
    setHashtag(null);
    update(next.text);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!opened || event.nativeEvent.isComposing || !NAVIGATION_KEYS.has(event.key)) return;
    const count = suggestions.length;
    const chosen = suggestions[highlighted];
    const accepting = event.key === "Enter" || event.key === "Tab";
    if (accepting ? !chosen || event.shiftKey : event.key !== "Escape" && count === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowDown") setHighlighted(index => (index + 1) % count);
    if (event.key === "ArrowUp") setHighlighted(index => (index + count - 1) % count);
    if (event.key === "Escape") dismiss();
    if (accepting && chosen) accept(chosen);
  };

  const anchorAt = hashtag?.start ?? text.length;
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <Combobox store={combobox} onOptionSubmit={accept} position="bottom-start" offset={4} width="max-content">
      <div className={classes.field}>
        <div className={classes.backdrop} aria-hidden>
          <Highlighted text={text.slice(0, anchorAt)} />
          <Combobox.DropdownTarget>
            <span className={classes.anchor} />
          </Combobox.DropdownTarget>
          <Highlighted text={text.slice(anchorAt)} />
          {"\u200b"}
        </div>
        <textarea
          ref={textarea}
          className={classes.input}
          value={text}
          readOnly={!editable}
          rows={1}
          aria-label={t("lightbox.sidebar.caption")}
          aria-autocomplete="list"
          aria-expanded={opened}
          aria-controls={opened ? listId : undefined}
          aria-activedescendant={opened && suggestions.length ? optionId(highlighted) : undefined}
          onChange={event => {
            update(event.currentTarget.value);
            followCaret(event.currentTarget);
          }}
          onSelect={event => followCaret(event.currentTarget)}
          onKeyDown={onKeyDown}
          onBlur={() => setHashtag(null)}
        />
      </div>
      <Combobox.Dropdown>
        <Combobox.Options id={listId}>
          {suggestions.length ? (
            suggestions.map((suggestion, index) => (
              <Combobox.Option
                key={suggestion}
                id={optionId(index)}
                value={suggestion}
                selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
              >
                #{suggestion}
              </Combobox.Option>
            ))
          ) : (
            <Combobox.Empty>{t("lightbox.sidebar.noMentionResults")}</Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
