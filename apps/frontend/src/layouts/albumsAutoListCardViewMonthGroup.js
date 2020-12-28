import React, { PureComponent } from "react";
import {List, AutoSizer, WindowScroller} from 'react-virtualized';
import styles from 'react-virtualized/styles.css'; // only needs to be imported once


export class ListExample extends PureComponent {
  constructor(props, context) {
    super(props, context);

    this.state = {
      listHeight: 300,
      listRowHeight: 50,
      overscanRowCount: 10,
      rowCount: 10,
      scrollToIndex: undefined,
      showScrollingPlaceholder: false,
      useDynamicRowHeight: false
    };

    this._getRowHeight = this._getRowHeight.bind(this);
    this._noRowsRenderer = this._noRowsRenderer.bind(this);
    this._onRowCountChange = this._onRowCountChange.bind(this);
    this._onScrollToRowChange = this._onScrollToRowChange.bind(this);
    this._rowRenderer = this._rowRenderer.bind(this);
  }

  render() {
    const {
      listHeight,
      listRowHeight,
      overscanRowCount,
      rowCount,
      scrollToIndex,
      showScrollingPlaceholder,
      useDynamicRowHeight
    } = this.state;

    return (
        <div>
        <WindowScroller>
          <AutoSizer disableHeight>
            {({ width }) =>
              <List
                ref="List"
                className={styles.List}
                height={listHeight}
                overscanRowCount={overscanRowCount}
                noRowsRenderer={this._noRowsRenderer}
                rowCount={rowCount}
                rowHeight={
                  useDynamicRowHeight ? this._getRowHeight : listRowHeight
                }
                rowRenderer={this._rowRenderer}
                scrollToIndex={scrollToIndex}
                width={width}
              />}
          </AutoSizer>
          </WindowScroller>
        </div>
    );
  }

  _getDatum(index) {
    const list = [1,2,3,4,5];

    return list[index % list.length];
  }

  _getRowHeight({ index }) {
    return this._getDatum(index);
  }

  _noRowsRenderer() {
    return <div>No rows</div>;
  }

  _onRowCountChange(event) {
    const rowCount = parseInt(event.target.value, 10) || 0;

    this.setState({ rowCount });
  }

  _onScrollToRowChange(event) {
    const { rowCount } = this.state;
    let scrollToIndex = Math.min(
      rowCount - 1,
      parseInt(event.target.value, 10)
    );

    if (isNaN(scrollToIndex)) {
      scrollToIndex = undefined;
    }

    this.setState({ scrollToIndex });
  }

  _rowRenderer({ index, isScrolling, key, style }) {
    const { showScrollingPlaceholder, useDynamicRowHeight } = this.state;

    return (
      <div>
        hello
      </div>
    );
  }
}
