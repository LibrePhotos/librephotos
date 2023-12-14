import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";

type Props = {
  items: string[];
  command: (params: { id: string }) => void;
};

export const MentionList = forwardRef((props: Props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = index => {
    const item = props.items[index];

    if (item) {
      props.command({ id: item });
    }
  };

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }

      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }

      if (event.key === "Enter") {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  return (
    <div
      style={{
        padding: "0.2rem",
        position: "relative",
        borderRadius: "0.5rem",
        background: "#FFF",
        color: "rgba(0, 0, 0, 0.8)",
        overflow: "hidden",
        fontSize: "0.9rem",
      }}
    >
      {props.items.length ? (
        props.items.map((item, index) => (
          <button
            type="button"
            style={{
              display: "block",
              margin: "0",
              background: "transparent",
              padding: "0.2rem 0.5rem",
              width: "100%",
              textAlign: "left",
              border: "1px solid transparent",
              borderRadius: "0.4rem",
              cursor: "pointer",
              borderColor: index === selectedIndex ? "#000" : "transparent",
            }}
            key={item}
            onClick={() => selectItem(index)}
          >
            {item}
          </button>
        ))
      ) : (
        <div className="item">No result</div>
      )}
    </div>
  );
});
