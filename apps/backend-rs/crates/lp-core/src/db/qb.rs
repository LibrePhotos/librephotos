//! [`Qb`]: `sqlx::QueryBuilder` for both dialects.
//!
//! Same method names (`push`, `push_bind`, `separated`, `push_values`,
//! `push_tuples`, `build`, `build_query_as`, `build_query_scalar`, `sql`,
//! `reset`, `into_sql`). Binds are `$N` on both drivers. Dialect-specific
//! fragments go through [`Qb::push_dialect`] (or the `sql::` helpers that use
//! it, e.g. [`super::sql::any`]); the builder then keeps one SQL text per
//! dialect and the executor picks the right one.

use std::fmt::{Display, Write as _};
use std::marker::PhantomData;

use super::arg::{Arg, IntoArg};
use super::exec::Dialect;
use super::query::{FromDbRow, Q, QueryAs, QueryScalar, Scalar, SqlText};

/// `QueryBuilder<'args, Postgres>` of this layer. The lifetime only mirrors
/// sqlx's signature (`&mut Qb<'_>`); arguments are owned.
#[derive(Debug, Clone, Default)]
pub struct Qb<'args> {
    pg: String,
    /// `None` while both dialects share the text.
    lite: Option<String>,
    args: Vec<Arg>,
    _p: PhantomData<&'args ()>,
}

impl<'args> Qb<'args> {
    pub fn new(init: impl Into<String>) -> Self {
        Qb {
            pg: init.into(),
            lite: None,
            args: Vec::new(),
            _p: PhantomData,
        }
    }

    /// Appends SQL text to both dialects.
    pub fn push(&mut self, sql: impl Display) -> &mut Self {
        let start = self.pg.len();
        let _ = write!(self.pg, "{sql}");
        if let Some(l) = &mut self.lite {
            l.push_str(&self.pg[start..]);
        }
        self
    }

    /// Appends a different fragment per dialect.
    pub fn push_dialect(&mut self, pg: impl Display, lite: impl Display) -> &mut Self {
        let l = self.lite.get_or_insert_with(|| self.pg.clone());
        let _ = write!(l, "{lite}");
        let _ = write!(self.pg, "{pg}");
        self
    }

    /// Appends the fragment of `d`'s dialect computed by `f`, for both
    /// dialects (`qb.push_with(|d| sql::date_of(d, "p.exif_timestamp"))`).
    pub fn push_with(&mut self, f: impl Fn(Dialect) -> String) -> &mut Self {
        let pg = f(Dialect::Pg);
        let lite = f(Dialect::Sqlite);
        if pg == lite && self.lite.is_none() {
            return self.push(pg);
        }
        self.push_dialect(pg, lite)
    }

    /// Binds a value and appends its placeholder `$N`.
    pub fn push_bind<T: IntoArg>(&mut self, value: T) -> &mut Self {
        let n = self.bind_arg(value.into_arg());
        self.push(format_args!("${n}"))
    }

    /// Binds a value without appending anything; returns its `N` for a
    /// placeholder written later (possibly per dialect).
    pub fn bind_arg(&mut self, arg: Arg) -> usize {
        self.args.push(arg);
        self.args.len()
    }

    /// Number of bound arguments so far.
    pub fn arg_count(&self) -> usize {
        self.args.len()
    }

    pub fn separated<'qb, Sep: Display>(
        &'qb mut self,
        separator: Sep,
    ) -> Separated<'qb, 'args, Sep> {
        Separated {
            qb: self,
            separator,
            push_separator: false,
        }
    }

    /// `VALUES (..), (..)`: `push_tuple` pushes one row's values.
    pub fn push_values<I, F>(&mut self, tuples: I, mut push_tuple: F) -> &mut Self
    where
        I: IntoIterator,
        F: FnMut(Separated<'_, 'args, &'static str>, I::Item),
    {
        self.push("VALUES ");
        for (i, tuple) in tuples.into_iter().enumerate() {
            if i > 0 {
                self.push(", ");
            }
            self.push("(");
            push_tuple(self.separated(", "), tuple);
            self.push(")");
        }
        self
    }

    /// `((..), (..))`, for `WHERE (a, b) IN ...`.
    pub fn push_tuples<I, F>(&mut self, tuples: I, mut push_tuple: F) -> &mut Self
    where
        I: IntoIterator,
        F: FnMut(Separated<'_, 'args, &'static str>, I::Item),
    {
        self.push("(");
        for (i, tuple) in tuples.into_iter().enumerate() {
            if i > 0 {
                self.push(", ");
            }
            self.push("(");
            push_tuple(self.separated(", "), tuple);
            self.push(")");
        }
        self.push(")");
        self
    }

    fn take(&mut self) -> Q<'_> {
        let args = std::mem::take(&mut self.args);
        let sql = match &self.lite {
            None => SqlText::One(self.pg.as_str().into()),
            Some(l) => SqlText::Two {
                pg: self.pg.as_str().into(),
                lite: l.as_str().into(),
            },
        };
        Q::with_args(sql, args)
    }

    /// The query; the arguments move into it (build once, like sqlx).
    pub fn build(&mut self) -> Q<'_> {
        self.take()
    }

    pub fn build_query_as<T: FromDbRow>(&mut self) -> QueryAs<'_, T> {
        QueryAs::from_q(self.take())
    }

    pub fn build_query_scalar<T: Scalar>(&mut self) -> QueryScalar<'_, T> {
        QueryScalar::from_q(self.take())
    }

    /// The Postgres SQL text built so far.
    pub fn sql(&self) -> &str {
        &self.pg
    }

    pub fn sql_for(&self, d: Dialect) -> &str {
        match (d, &self.lite) {
            (Dialect::Sqlite, Some(l)) => l,
            _ => &self.pg,
        }
    }

    pub fn into_sql(self) -> String {
        self.pg
    }

    pub fn reset(&mut self) -> &mut Self {
        self.pg.clear();
        self.lite = None;
        self.args.clear();
        self
    }
}

/// `sqlx::query_builder::Separated`.
#[derive(Debug)]
pub struct Separated<'qb, 'args, Sep> {
    qb: &'qb mut Qb<'args>,
    separator: Sep,
    push_separator: bool,
}

impl<'qb, 'args, Sep: Display> Separated<'qb, 'args, Sep> {
    pub fn push(&mut self, sql: impl Display) -> &mut Self {
        if self.push_separator {
            self.qb.push(format_args!("{}{}", self.separator, sql));
        } else {
            self.qb.push(sql);
            self.push_separator = true;
        }
        self
    }

    pub fn push_unseparated(&mut self, sql: impl Display) -> &mut Self {
        self.qb.push(sql);
        self
    }

    pub fn push_bind<T: IntoArg>(&mut self, value: T) -> &mut Self {
        if self.push_separator {
            self.qb.push(&self.separator);
        }
        self.qb.push_bind(value);
        self.push_separator = true;
        self
    }

    pub fn push_bind_unseparated<T: IntoArg>(&mut self, value: T) -> &mut Self {
        self.qb.push_bind(value);
        self
    }

    /// Per-dialect fragment, separated like [`Separated::push`].
    pub fn push_dialect(&mut self, pg: impl Display, lite: impl Display) -> &mut Self {
        if self.push_separator {
            self.qb.push(&self.separator);
        }
        self.qb.push_dialect(pg, lite);
        self.push_separator = true;
        self
    }

    /// The underlying builder (e.g. for `sql::any(sep.qb(), ..)`).
    pub fn qb(&mut self) -> &mut Qb<'args> {
        self.qb
    }
}
