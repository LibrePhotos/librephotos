use std::collections::HashMap;
use std::ops::Range;

#[derive(Debug, Clone)]
pub struct Attr {
    pub name: String,
    pub raw_value: String,
    pub range: Range<usize>,
}

impl Attr {
    pub fn value(&self) -> String {
        unescape(&self.raw_value)
    }
}

#[derive(Debug, Clone)]
pub enum Node {
    Element(usize),
    Text(Range<usize>),
    Cdata(Range<usize>),
    Other,
}

#[derive(Debug, Clone)]
pub struct Element {
    pub name: String,
    pub attrs: Vec<Attr>,
    pub start_tag: Range<usize>,
    pub close_at: usize,
    pub end_tag: Option<Range<usize>>,
    pub children: Vec<Node>,
    pub parent: Option<usize>,
    pub scope: HashMap<String, String>,
}

impl Element {
    pub fn outer(&self) -> Range<usize> {
        self.start_tag.start..self.end_tag.as_ref().map_or(self.start_tag.end, |e| e.end)
    }

    pub fn prefix(&self) -> &str {
        self.name.split_once(':').map_or("", |(p, _)| p)
    }

    pub fn local(&self) -> &str {
        self.name
            .split_once(':')
            .map_or(self.name.as_str(), |(_, l)| l)
    }

    pub fn ns(&self) -> Option<&str> {
        self.scope.get(self.prefix()).map(String::as_str)
    }

    pub fn is(&self, ns: &str, local: &str) -> bool {
        self.local() == local && self.ns() == Some(ns)
    }

    pub fn attr_ns<'a>(&'a self, attr: &'a Attr) -> Option<&'a str> {
        let (prefix, _) = attr.name.split_once(':')?;
        if prefix == "xmlns" {
            return None;
        }
        self.scope.get(prefix).map(String::as_str)
    }

    pub fn attr(&self, ns: &str, local: &str) -> Option<&Attr> {
        self.attrs.iter().find(|a| {
            a.name.split_once(':').is_some_and(|(_, l)| l == local) && self.attr_ns(a) == Some(ns)
        })
    }

    pub fn prefix_for(&self, ns: &str) -> Option<&str> {
        self.scope
            .iter()
            .filter(|(p, u)| u.as_str() == ns && !p.is_empty())
            .map(|(p, _)| p.as_str())
            .min()
    }
}

#[derive(Debug)]
pub struct Doc<'a> {
    pub src: &'a str,
    pub elements: Vec<Element>,
    pub roots: Vec<Node>,
}

pub const XML_NS: &str = "http://www.w3.org/XML/1998/namespace";

impl<'a> Doc<'a> {
    pub fn parse(src: &'a str) -> Result<Doc<'a>, String> {
        Parser {
            src,
            pos: 0,
            elements: Vec::new(),
        }
        .run()
    }

    pub fn el(&self, i: usize) -> &Element {
        &self.elements[i]
    }

    pub fn child_elements(&self, i: usize) -> impl Iterator<Item = usize> + '_ {
        self.elements[i].children.iter().filter_map(|n| match n {
            Node::Element(c) => Some(*c),
            _ => None,
        })
    }

    pub fn find_all(&self, ns: &str, local: &str) -> Vec<usize> {
        (0..self.elements.len())
            .filter(|&i| self.elements[i].is(ns, local))
            .collect()
    }

    pub fn text(&self, i: usize) -> String {
        let mut out = String::new();
        for n in &self.elements[i].children {
            match n {
                Node::Text(r) => out.push_str(&unescape(&self.src[r.clone()])),
                Node::Cdata(r) => out.push_str(&self.src[r.clone()]),
                Node::Element(c) => out.push_str(&self.text(*c)),
                Node::Other => {}
            }
        }
        out
    }

    pub fn has_element_children(&self, i: usize) -> bool {
        self.child_elements(i).next().is_some()
    }
}

struct Parser<'a> {
    src: &'a str,
    pos: usize,
    elements: Vec<Element>,
}

impl<'a> Parser<'a> {
    fn rest(&self) -> &'a str {
        &self.src[self.pos..]
    }

    fn find(&self, pat: &str) -> Result<usize, String> {
        self.rest()
            .find(pat)
            .map(|i| self.pos + i)
            .ok_or_else(|| format!("unterminated markup at byte {}", self.pos))
    }

    fn run(mut self) -> Result<Doc<'a>, String> {
        let mut roots: Vec<Node> = Vec::new();
        let mut stack: Vec<usize> = Vec::new();
        while self.pos < self.src.len() {
            let node = if self.rest().starts_with("<!--") {
                self.pos = self.find("-->")? + 3;
                Some(Node::Other)
            } else if self.rest().starts_with("<![CDATA[") {
                let start = self.pos + 9;
                let end = self.find("]]>")?;
                self.pos = end + 3;
                Some(Node::Cdata(start..end))
            } else if self.rest().starts_with("<?") {
                self.pos = self.find("?>")? + 2;
                Some(Node::Other)
            } else if self.rest().starts_with("<!") {
                self.pos = self.find(">")? + 1;
                Some(Node::Other)
            } else if self.rest().starts_with("</") {
                let start = self.pos;
                let end = self.find(">")?;
                let name = self.src[start + 2..end].trim().to_string();
                self.pos = end + 1;
                let open = stack.pop().ok_or_else(|| format!("unexpected </{name}>"))?;
                if self.elements[open].name != name {
                    return Err(format!("</{name}> closes <{}>", self.elements[open].name));
                }
                self.elements[open].end_tag = Some(start..end + 1);
                None
            } else if self.rest().starts_with('<') {
                let parent = stack.last().copied();
                let (idx, empty) = self.start_tag(parent)?;
                match parent {
                    Some(p) => self.elements[p].children.push(Node::Element(idx)),
                    None => roots.push(Node::Element(idx)),
                }
                if !empty {
                    stack.push(idx);
                }
                None
            } else {
                let start = self.pos;
                let end = self
                    .rest()
                    .find('<')
                    .map_or(self.src.len(), |i| self.pos + i);
                self.pos = end;
                Some(Node::Text(start..end))
            };
            if let Some(node) = node {
                match stack.last() {
                    Some(&top) => self.elements[top].children.push(node),
                    None => roots.push(node),
                }
            }
        }
        if let Some(open) = stack.pop() {
            return Err(format!("<{}> is never closed", self.elements[open].name));
        }
        Ok(Doc {
            src: self.src,
            elements: self.elements,
            roots,
        })
    }

    fn name_end(&self, from: usize) -> usize {
        self.src[from..]
            .find(|c: char| c.is_whitespace() || c == '/' || c == '>' || c == '=')
            .map_or(self.src.len(), |i| from + i)
    }

    fn skip_ws(&mut self) {
        let n = self.rest().len() - self.rest().trim_start().len();
        self.pos += n;
    }

    fn start_tag(&mut self, parent: Option<usize>) -> Result<(usize, bool), String> {
        let start = self.pos;
        let name_end = self.name_end(start + 1);
        let name = self.src[start + 1..name_end].to_string();
        if name.is_empty() {
            return Err(format!("empty tag name at byte {start}"));
        }
        self.pos = name_end;
        let mut attrs = Vec::new();
        let (close_at, empty) = loop {
            let before = self.pos;
            self.skip_ws();
            let rest = self.rest();
            if rest.starts_with("/>") {
                let at = self.pos;
                self.pos += 2;
                break (at, true);
            }
            if rest.starts_with('>') {
                let at = self.pos;
                self.pos += 1;
                break (at, false);
            }
            if rest.is_empty() {
                return Err(format!("<{name}> is cut off"));
            }
            let a_start = self.pos;
            let a_end = self.name_end(a_start);
            if a_end == a_start {
                return Err(format!("bad attribute in <{name}>"));
            }
            let a_name = self.src[a_start..a_end].to_string();
            self.pos = a_end;
            self.skip_ws();
            if !self.rest().starts_with('=') {
                return Err(format!("attribute {a_name} without a value"));
            }
            self.pos += 1;
            self.skip_ws();
            let quote = self
                .rest()
                .chars()
                .next()
                .filter(|c| *c == '"' || *c == '\'')
                .ok_or_else(|| format!("unquoted attribute {a_name}"))?;
            let v_start = self.pos + 1;
            let v_end = self.src[v_start..]
                .find(quote)
                .map(|i| v_start + i)
                .ok_or_else(|| format!("unterminated attribute {a_name}"))?;
            self.pos = v_end + 1;
            attrs.push(Attr {
                name: a_name,
                raw_value: self.src[v_start..v_end].to_string(),
                range: before..self.pos,
            });
        };
        let mut scope = parent
            .map(|p| self.elements[p].scope.clone())
            .unwrap_or_else(|| HashMap::from([("xml".to_string(), XML_NS.to_string())]));
        for a in &attrs {
            if let Some(prefix) = a.name.strip_prefix("xmlns:") {
                scope.insert(prefix.to_string(), a.value());
            } else if a.name == "xmlns" {
                scope.insert(String::new(), a.value());
            }
        }
        self.elements.push(Element {
            name,
            attrs,
            start_tag: start..self.pos,
            close_at,
            end_tag: None,
            children: Vec::new(),
            parent,
            scope,
        });
        Ok((self.elements.len() - 1, empty))
    }
}

pub fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let Some(end) = after.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = after;
            continue;
        };
        let entity = &after[..end];
        let ch = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &after[end + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn escape_attr(s: &str) -> String {
    escape_text(s).replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nesting_namespaces_and_entities() {
        let src = "<?xml version='1.0'?><a xmlns:p='urn:p'><!-- c --><p:b k=\"v &amp; w\">x &lt; y<![CDATA[<z>]]></p:b><c/></a>";
        let doc = Doc::parse(src).unwrap();
        let b = doc.find_all("urn:p", "b");
        assert_eq!(b.len(), 1);
        assert_eq!(doc.text(b[0]), "x < y<z>");
        assert_eq!(doc.el(b[0]).attrs[0].value(), "v & w");
        assert_eq!(
            &src[doc.el(b[0]).outer()],
            "<p:b k=\"v &amp; w\">x &lt; y<![CDATA[<z>]]></p:b>"
        );
        let a = doc.el(b[0]).parent.unwrap();
        assert_eq!(doc.child_elements(a).count(), 2);
        assert_eq!(doc.roots.len(), 2);
    }

    #[test]
    fn rejects_broken_markup() {
        assert!(Doc::parse("<a><b></a>").is_err());
        assert!(Doc::parse("<a>").is_err());
        assert!(Doc::parse("<a b=c/>").is_err());
        assert!(Doc::parse("</a>").is_err());
        assert!(Doc::parse("<a b='x/>").is_err());
    }

    #[test]
    fn unescapes_and_escapes() {
        assert_eq!(unescape("&#65;&#x42;&amp;&bogus; & x"), "AB&&bogus; & x");
        assert_eq!(escape_attr("a<\"&"), "a&lt;&quot;&amp;");
    }
}
