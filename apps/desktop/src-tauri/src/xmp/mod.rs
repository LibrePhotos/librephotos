pub mod files;
pub mod xml;

use std::collections::HashSet;
use std::ops::Range;

use serde::Deserialize;

use xml::{Doc, XML_NS, escape_attr, escape_text};

pub const NS_RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
pub const NS_XMP: &str = "http://ns.adobe.com/xap/1.0/";
pub const NS_DC: &str = "http://purl.org/dc/elements/1.1/";
pub const NS_LR: &str = "http://ns.adobe.com/lightroom/1.0/";
pub const NS_PHOTOSHOP: &str = "http://ns.adobe.com/photoshop/1.0/";
pub const NS_EXIF: &str = "http://ns.adobe.com/exif/1.0/";

const PREFERRED_PREFIX: [(&str, &str); 6] = [
    (NS_RDF, "rdf"),
    (NS_XMP, "xmp"),
    (NS_DC, "dc"),
    (NS_LR, "lr"),
    (NS_PHOTOSHOP, "photoshop"),
    (NS_EXIF, "exif"),
];

const NEW_PACKET: &str = "<?xpacket begin='\u{feff}' id='W5M0MpCehiHzreSzNTczkc9d'?>\n<x:xmpmeta xmlns:x='adobe:ns:meta/' x:xmptk='LibrePhotos Viewer'>\n <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>\n  <rdf:Description rdf:about=''/>\n </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end='w'?>\n";

#[derive(Debug, Default, Clone, PartialEq)]
pub struct XmpFields {
    pub rating: Option<i32>,
    pub caption: Option<String>,
    pub subject: Option<Vec<String>>,
    pub hierarchical: Option<Vec<String>>,
    pub date_created: Option<String>,
    pub date_time_original: Option<String>,
    pub gps: Option<(f64, f64)>,
}

impl XmpFields {
    pub fn keywords(&self) -> Option<Vec<String>> {
        if self.subject.is_none() && self.hierarchical.is_none() {
            return None;
        }
        Some(merge_keywords(
            self.subject.as_deref().unwrap_or_default(),
            self.hierarchical.as_deref().unwrap_or_default(),
        ))
    }
}

pub fn merge_keywords(subject: &[String], hierarchical: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let leaves = hierarchical.iter().filter_map(|h| hierarchy_leaf(h));
    subject
        .iter()
        .map(|s| s.trim().to_string())
        .chain(leaves)
        .filter(|k| !k.is_empty() && seen.insert(k.to_lowercase()))
        .collect()
}

fn hierarchy_leaf(path: &str) -> Option<String> {
    let leaf = path.rsplit('|').next()?.trim();
    (!leaf.is_empty()).then(|| leaf.to_string())
}

#[derive(Debug, Default, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Edits {
    pub rating: Option<u8>,
    pub caption: Option<String>,
    pub keywords: Option<Vec<String>>,
    pub taken_at: Option<String>,
}

impl Edits {
    pub fn is_empty(&self) -> bool {
        self.rating.is_none()
            && self.caption.is_none()
            && self.keywords.is_none()
            && self.taken_at.is_none()
    }
}

enum Prop {
    Attr(String),
    Elem(usize),
}

fn top_descriptions(doc: &Doc) -> Vec<usize> {
    doc.find_all(NS_RDF, "Description")
        .into_iter()
        .filter(|&d| {
            doc.el(d)
                .parent
                .is_some_and(|p| doc.el(p).is(NS_RDF, "RDF"))
        })
        .collect()
}

fn property(doc: &Doc, descs: &[usize], ns: &str, local: &str) -> Option<Prop> {
    for &d in descs {
        let el = doc.el(d);
        if let Some(a) = el.attr(ns, local) {
            return Some(Prop::Attr(a.value()));
        }
        if let Some(c) = doc.child_elements(d).find(|&c| doc.el(c).is(ns, local)) {
            return Some(Prop::Elem(c));
        }
    }
    None
}

fn items(doc: &Doc, prop: usize) -> Option<Vec<(Option<String>, String)>> {
    let container = doc.child_elements(prop).find(|&c| {
        let e = doc.el(c);
        e.is(NS_RDF, "Alt") || e.is(NS_RDF, "Bag") || e.is(NS_RDF, "Seq")
    })?;
    Some(
        doc.child_elements(container)
            .filter(|&li| doc.el(li).is(NS_RDF, "li"))
            .map(|li| {
                let lang = doc.el(li).attr(XML_NS, "lang").map(|a| a.value());
                (lang, doc.text(li).trim().to_string())
            })
            .collect(),
    )
}

fn simple(doc: &Doc, prop: &Prop) -> Option<String> {
    let s = match prop {
        Prop::Attr(v) => v.trim().to_string(),
        Prop::Elem(e) if doc.has_element_children(*e) => {
            items(doc, *e)?.into_iter().next().map(|(_, v)| v)?
        }
        Prop::Elem(e) => doc.text(*e).trim().to_string(),
    };
    (!s.is_empty()).then_some(s)
}

fn list(doc: &Doc, prop: &Prop) -> Vec<String> {
    match prop {
        Prop::Attr(v) => vec![v.trim().to_string()],
        Prop::Elem(e) if doc.has_element_children(*e) => items(doc, *e)
            .unwrap_or_default()
            .into_iter()
            .map(|(_, v)| v)
            .collect(),
        Prop::Elem(e) => vec![doc.text(*e).trim().to_string()],
    }
    .into_iter()
    .filter(|v| !v.is_empty())
    .collect()
}

fn lang_alt(doc: &Doc, prop: &Prop) -> Vec<(Option<String>, String)> {
    match prop {
        Prop::Elem(e) if doc.has_element_children(*e) => items(doc, *e).unwrap_or_default(),
        _ => simple(doc, prop)
            .map(|v| vec![(None, v)])
            .unwrap_or_default(),
    }
}

fn default_entry(entries: &[(Option<String>, String)]) -> Option<String> {
    entries
        .iter()
        .find(|(l, _)| l.as_deref() == Some("x-default"))
        .or_else(|| entries.iter().find(|(l, _)| l.is_none()))
        .or_else(|| entries.first())
        .map(|(_, v)| v.clone())
        .filter(|v| !v.is_empty())
}

pub fn read_fields(src: &str) -> Result<XmpFields, String> {
    let doc = Doc::parse(src)?;
    let descs = top_descriptions(&doc);
    let get = |ns: &str, local: &str| property(&doc, &descs, ns, local);
    Ok(XmpFields {
        rating: get(NS_XMP, "Rating")
            .and_then(|p| simple(&doc, &p))
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .map(|v| v.round().clamp(-1.0, 5.0) as i32),
        caption: get(NS_DC, "description").and_then(|p| default_entry(&lang_alt(&doc, &p))),
        subject: get(NS_DC, "subject").map(|p| list(&doc, &p)),
        hierarchical: get(NS_LR, "hierarchicalSubject").map(|p| list(&doc, &p)),
        date_created: get(NS_PHOTOSHOP, "DateCreated")
            .and_then(|p| simple(&doc, &p))
            .and_then(|v| xmp_date_to_local(&v)),
        date_time_original: get(NS_EXIF, "DateTimeOriginal")
            .and_then(|p| simple(&doc, &p))
            .and_then(|v| xmp_date_to_local(&v)),
        gps: match (
            get(NS_EXIF, "GPSLatitude").and_then(|p| simple(&doc, &p)),
            get(NS_EXIF, "GPSLongitude").and_then(|p| simple(&doc, &p)),
        ) {
            (Some(lat), Some(lon)) => parse_gps(&lat).zip(parse_gps(&lon)),
            _ => None,
        },
    })
}

pub fn xmp_date_to_local(s: &str) -> Option<String> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 10 {
        return None;
    }
    let date = s.get(..10)?.replace(':', "-");
    let db = date.as_bytes();
    let digits = |r: Range<usize>| db[r].iter().all(u8::is_ascii_digit);
    if !(digits(0..4) && db[4] == b'-' && digits(5..7) && db[7] == b'-' && digits(8..10))
        || date.starts_with("0000")
    {
        return None;
    }
    let month: u32 = date[5..7].parse().ok()?;
    let day: u32 = date[8..10].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if b.len() < 16 || !(b[10] == b'T' || b[10] == b' ') {
        return Some(format!("{date}T00:00:00"));
    }
    let hm = s.get(11..16)?;
    let hb = hm.as_bytes();
    if !(hb[0..2].iter().all(u8::is_ascii_digit)
        && hb[2] == b':'
        && hb[3..5].iter().all(u8::is_ascii_digit))
    {
        return None;
    }
    let secs = match s.get(16..19) {
        Some(sec) if sec.starts_with(':') && sec[1..].bytes().all(|c| c.is_ascii_digit()) => {
            &sec[1..]
        }
        _ => "00",
    };
    Some(format!("{date}T{hm}:{secs}"))
}

pub fn parse_gps(v: &str) -> Option<f64> {
    let v = v.trim();
    if let Ok(d) = v.parse::<f64>() {
        return d.is_finite().then_some(d);
    }
    let last = v.chars().last()?.to_ascii_uppercase();
    let sign = match last {
        'N' | 'E' => 1.0,
        'S' | 'W' => -1.0,
        _ => return None,
    };
    let body = &v[..v.len() - 1];
    let parts: Vec<f64> = body
        .split(',')
        .map(|p| p.trim().parse::<f64>())
        .collect::<Result<_, _>>()
        .ok()?;
    let deg = match parts.as_slice() {
        [d] => *d,
        [d, m] => d + m / 60.0,
        [d, m, s] => d + m / 60.0 + s / 3600.0,
        _ => return None,
    };
    deg.is_finite().then_some(sign * deg)
}

struct Splice {
    range: Range<usize>,
    text: String,
}

fn apply_splices(src: &str, mut splices: Vec<Splice>) -> String {
    splices.sort_by_key(|s| std::cmp::Reverse((s.range.start, s.range.end)));
    let mut out = src.to_string();
    for s in splices {
        out.replace_range(s.range, &s.text);
    }
    out
}

fn cut_with_indent(src: &str, range: Range<usize>) -> Range<usize> {
    let before = &src[..range.start];
    let trimmed = before.trim_end_matches([' ', '\t']);
    let start = trimmed
        .strip_suffix('\n')
        .map(|t| t.strip_suffix('\r').unwrap_or(t).len())
        .unwrap_or(range.start);
    start..range.end
}

fn occurrences(doc: &Doc, descs: &[usize], ns: &str, local: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    for &d in descs {
        let el = doc.el(d);
        for a in &el.attrs {
            if el.attr_ns(a) == Some(ns) && a.name.split_once(':').is_some_and(|(_, l)| l == local)
            {
                out.push(a.range.clone());
            }
        }
        for c in doc.child_elements(d) {
            if doc.el(c).is(ns, local) {
                out.push(cut_with_indent(doc.src, doc.el(c).outer()));
            }
        }
    }
    out
}

type Render = Box<dyn Fn(&str, &str) -> String>;

struct NewProp {
    ns: &'static str,
    render: Render,
}

fn element_text(prefix: &str, local: &str, value: &str) -> String {
    format!(
        "\n   <{prefix}:{local}>{}</{prefix}:{local}>",
        escape_text(value)
    )
}

fn container(
    prefix: &str,
    local: &str,
    rdf: &str,
    kind: &str,
    items: &[(Option<String>, String)],
) -> String {
    let mut s = format!("\n   <{prefix}:{local}>\n    <{rdf}:{kind}>");
    for (lang, v) in items {
        match lang {
            Some(l) => s.push_str(&format!(
                "\n     <{rdf}:li xml:lang=\"{}\">{}</{rdf}:li>",
                escape_attr(l),
                escape_text(v)
            )),
            None => s.push_str(&format!("\n     <{rdf}:li>{}</{rdf}:li>", escape_text(v))),
        }
    }
    s.push_str(&format!("\n    </{rdf}:{kind}>\n   </{prefix}:{local}>"));
    s
}

pub fn new_packet(edits: &Edits) -> Result<String, String> {
    update_packet(NEW_PACKET, edits)
}

pub fn update_packet(src: &str, edits: &Edits) -> Result<String, String> {
    let doc = Doc::parse(src)?;
    let rdf_root = doc
        .find_all(NS_RDF, "RDF")
        .into_iter()
        .next()
        .ok_or("the XMP has no rdf:RDF element")?;
    let descs = top_descriptions(&doc);
    let mut splices: Vec<Splice> = Vec::new();
    let mut add: Vec<NewProp> = Vec::new();
    let remove = |ns: &str, local: &str, splices: &mut Vec<Splice>| {
        for range in occurrences(&doc, &descs, ns, local) {
            splices.push(Splice {
                range,
                text: String::new(),
            });
        }
    };

    if let Some(rating) = edits.rating {
        remove(NS_XMP, "Rating", &mut splices);
        let value = rating.min(5).to_string();
        add.push(NewProp {
            ns: NS_XMP,
            render: Box::new(move |p, _| element_text(p, "Rating", &value)),
        });
    }
    if let Some(caption) = &edits.caption {
        let others: Vec<(Option<String>, String)> = property(&doc, &descs, NS_DC, "description")
            .map(|p| lang_alt(&doc, &p))
            .unwrap_or_default()
            .into_iter()
            .filter(|(l, v)| l.as_deref().is_some_and(|l| l != "x-default") && !v.is_empty())
            .collect();
        remove(NS_DC, "description", &mut splices);
        let caption = caption.trim().to_string();
        if !caption.is_empty() {
            let mut entries = vec![(Some("x-default".to_string()), caption)];
            entries.extend(others);
            add.push(NewProp {
                ns: NS_DC,
                render: Box::new(move |p, rdf| container(p, "description", rdf, "Alt", &entries)),
            });
        }
    }
    if let Some(keywords) = &edits.keywords {
        let wanted = merge_keywords(keywords, &[]);
        let wanted_keys: HashSet<String> = wanted.iter().map(|k| k.to_lowercase()).collect();
        let hierarchical =
            property(&doc, &descs, NS_LR, "hierarchicalSubject").map(|p| list(&doc, &p));
        remove(NS_DC, "subject", &mut splices);
        if !wanted.is_empty() {
            let entries: Vec<(Option<String>, String)> =
                wanted.iter().map(|k| (None, k.clone())).collect();
            add.push(NewProp {
                ns: NS_DC,
                render: Box::new(move |p, rdf| container(p, "subject", rdf, "Bag", &entries)),
            });
        }
        if let Some(hier) = hierarchical {
            let kept: Vec<String> = hier
                .iter()
                .filter(|h| {
                    hierarchy_leaf(h).is_some_and(|l| wanted_keys.contains(&l.to_lowercase()))
                })
                .cloned()
                .collect();
            if kept.len() != hier.len() {
                remove(NS_LR, "hierarchicalSubject", &mut splices);
                if !kept.is_empty() {
                    let entries: Vec<(Option<String>, String)> =
                        kept.into_iter().map(|k| (None, k)).collect();
                    add.push(NewProp {
                        ns: NS_LR,
                        render: Box::new(move |p, rdf| {
                            container(p, "hierarchicalSubject", rdf, "Bag", &entries)
                        }),
                    });
                }
            }
        }
    }
    if let Some(taken) = &edits.taken_at {
        remove(NS_PHOTOSHOP, "DateCreated", &mut splices);
        let taken = taken.trim();
        if !taken.is_empty() {
            let value =
                xmp_date_to_local(taken).ok_or_else(|| format!("not a date and time: {taken}"))?;
            add.push(NewProp {
                ns: NS_PHOTOSHOP,
                render: Box::new(move |p, _| element_text(p, "DateCreated", &value)),
            });
        }
    }

    if !add.is_empty() {
        splices.extend(insert_props(&doc, rdf_root, descs.first().copied(), &add)?);
    }
    let out = apply_splices(src, splices);
    Doc::parse(&out).map_err(|e| format!("the updated XMP does not parse: {e}"))?;
    Ok(out)
}

fn prefix_plan(
    doc: &Doc,
    host: usize,
    needed: &[&'static str],
) -> (Vec<(&'static str, String)>, String) {
    let el = doc.el(host);
    let mut taken: HashSet<String> = el.scope.keys().cloned().collect();
    let mut plan = Vec::new();
    let mut decls = String::new();
    for &ns in needed {
        if plan.iter().any(|(n, _): &(&str, String)| *n == ns) {
            continue;
        }
        if let Some(p) = el.prefix_for(ns) {
            plan.push((ns, p.to_string()));
            continue;
        }
        let base = PREFERRED_PREFIX
            .iter()
            .find(|(n, _)| *n == ns)
            .map_or("ns", |(_, p)| p);
        let mut prefix = base.to_string();
        let mut i = 2;
        while taken.contains(&prefix) {
            prefix = format!("{base}{i}");
            i += 1;
        }
        taken.insert(prefix.clone());
        decls.push_str(&format!("\n    xmlns:{prefix}=\"{}\"", escape_attr(ns)));
        plan.push((ns, prefix));
    }
    (plan, decls)
}

fn insert_props(
    doc: &Doc,
    rdf_root: usize,
    target: Option<usize>,
    add: &[NewProp],
) -> Result<Vec<Splice>, String> {
    let mut needed: Vec<&'static str> = add.iter().map(|p| p.ns).collect();
    needed.push(NS_RDF);
    let host = target.unwrap_or(rdf_root);
    let (plan, decls) = prefix_plan(doc, host, &needed);
    let prefix = |ns: &str| {
        plan.iter()
            .find(|(n, _)| *n == ns)
            .map(|(_, p)| p.clone())
            .unwrap_or_default()
    };
    let rdf = prefix(NS_RDF);
    let body: String = add
        .iter()
        .map(|p| (p.render)(&prefix(p.ns), &rdf))
        .collect();
    let Some(desc) = target else {
        let root = doc.el(rdf_root);
        let end = root.end_tag.as_ref().ok_or("rdf:RDF has no end tag")?;
        let at = insert_point(doc.src, end.start);
        return Ok(vec![Splice {
            range: at..at,
            text: format!(
                "\n  <{rdf}:Description {rdf}:about=\"\"{decls}>{body}\n  </{rdf}:Description>"
            ),
        }]);
    };
    let el = doc.el(desc);
    match &el.end_tag {
        Some(end) => {
            let at = insert_point(doc.src, end.start);
            Ok(vec![
                Splice {
                    range: el.close_at..el.close_at,
                    text: decls,
                },
                Splice {
                    range: at..at,
                    text: body,
                },
            ])
        }
        None => Ok(vec![Splice {
            range: el.close_at..el.start_tag.end,
            text: format!("{decls}>{body}\n  </{}>", el.name),
        }]),
    }
}

fn insert_point(src: &str, end_tag_start: usize) -> usize {
    src[..end_tag_start].trim_end().len()
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXIFTOOL: &str = r#"<?xpacket begin='' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x='adobe:ns:meta/' x:xmptk='Image::ExifTool 12.40'>
<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>

 <rdf:Description rdf:about=''
  xmlns:xmp='http://ns.adobe.com/xap/1.0/'>
  <xmp:Rating>2</xmp:Rating>
 </rdf:Description>

 <rdf:Description rdf:about=''
  xmlns:dc='http://purl.org/dc/elements/1.1/'
  xmlns:lr='http://ns.adobe.com/lightroom/1.0/'>
  <dc:description>
   <rdf:Alt>
    <rdf:li xml:lang='x-default'>Old caption</rdf:li>
    <rdf:li xml:lang='de'>Alte Beschriftung</rdf:li>
   </rdf:Alt>
  </dc:description>
  <dc:subject>
   <rdf:Bag>
    <rdf:li>beach</rdf:li>
    <rdf:li>Paris</rdf:li>
   </rdf:Bag>
  </dc:subject>
  <lr:hierarchicalSubject>
   <rdf:Bag>
    <rdf:li>Places|France|Paris</rdf:li>
    <rdf:li>Trips|Summer</rdf:li>
   </rdf:Bag>
  </lr:hierarchicalSubject>
  <dc:creator><rdf:Seq><rdf:li>Someone</rdf:li></rdf:Seq></dc:creator>
 </rdf:Description>
 <rdf:Description rdf:about='' xmlns:darktable='http://darktable.sf.net/' darktable:xmp_version='5'>
  <darktable:history><rdf:Seq><rdf:li darktable:operation='exposure'/></rdf:Seq></darktable:history>
 </rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end='w'?>"#;

    #[test]
    fn reads_an_exiftool_sidecar() {
        let f = read_fields(EXIFTOOL).unwrap();
        assert_eq!(f.rating, Some(2));
        assert_eq!(f.caption.as_deref(), Some("Old caption"));
        assert_eq!(f.keywords().unwrap(), vec!["beach", "Paris", "Summer"]);
        assert_eq!(f.date_created, None);
    }

    #[test]
    fn reads_attribute_properties_and_dates() {
        let src = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
 xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:d="http://purl.org/dc/elements/1.1/"
 xmp:Rating="4" photoshop:DateCreated="2021-07-04T18:30:05.120+02:00" exif:DateTimeOriginal="2021-07-04T18:30"
 exif:GPSLatitude="52,31.2N" exif:GPSLongitude="13,24.3W"><d:description>plain &amp; simple</d:description></rdf:Description>
</rdf:RDF></x:xmpmeta>"#;
        let f = read_fields(src).unwrap();
        assert_eq!(f.rating, Some(4));
        assert_eq!(f.caption.as_deref(), Some("plain & simple"));
        assert_eq!(f.date_created.as_deref(), Some("2021-07-04T18:30:05"));
        assert_eq!(f.date_time_original.as_deref(), Some("2021-07-04T18:30:00"));
        let (lat, lon) = f.gps.unwrap();
        assert!((lat - 52.52).abs() < 1e-9 && (lon + 13.405).abs() < 1e-9);
        assert_eq!(f.keywords(), None);
    }

    #[test]
    fn updates_in_place_and_keeps_everything_else() {
        let edits = Edits {
            rating: Some(5),
            caption: Some("New <caption> & more".into()),
            keywords: Some(vec!["beach".into(), "sunset".into(), "Summer".into()]),
            taken_at: Some("2020-01-02T03:04:05".into()),
        };
        let out = update_packet(EXIFTOOL, &edits).unwrap();
        let f = read_fields(&out).unwrap();
        assert_eq!(f.rating, Some(5));
        assert_eq!(f.caption.as_deref(), Some("New <caption> & more"));
        assert_eq!(f.subject.as_deref().unwrap(), ["beach", "sunset", "Summer"]);
        assert_eq!(f.hierarchical.as_deref().unwrap(), ["Trips|Summer"]);
        assert_eq!(f.keywords().unwrap(), vec!["beach", "sunset", "Summer"]);
        assert_eq!(f.date_created.as_deref(), Some("2020-01-02T03:04:05"));
        assert!(out.contains("<rdf:li xml:lang=\"de\">Alte Beschriftung</rdf:li>"));
        assert!(
            out.contains("<dc:creator><rdf:Seq><rdf:li>Someone</rdf:li></rdf:Seq></dc:creator>")
        );
        assert!(out.contains("darktable:operation='exposure'"));
        assert!(out.contains("x:xmptk='Image::ExifTool 12.40'"));
        assert_eq!(out.matches("Rating").count(), 2);
        assert!(!out.contains("Old caption"));
        assert!(!out.contains("Paris"));
    }

    #[test]
    fn removes_fields_with_empty_values() {
        let edits = Edits {
            rating: Some(0),
            caption: Some("  ".into()),
            keywords: Some(vec![]),
            taken_at: Some(String::new()),
        };
        let out = update_packet(EXIFTOOL, &edits).unwrap();
        let f = read_fields(&out).unwrap();
        assert_eq!(f.rating, Some(0));
        assert_eq!(f.caption, None);
        assert_eq!(f.subject, None);
        assert_eq!(f.hierarchical, None);
        assert!(!out.contains("dc:description"));
        assert!(out.contains("Someone"));
    }

    #[test]
    fn replaces_attribute_properties_and_adds_namespaces() {
        let src = "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'><rdf:Description rdf:about='' xmlns:xmp='http://ns.adobe.com/xap/1.0/' xmp:Rating='3' xmp:CreatorTool='digiKam'/></rdf:RDF></x:xmpmeta>";
        let out = update_packet(
            src,
            &Edits {
                rating: Some(1),
                keywords: Some(vec!["a".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        let f = read_fields(&out).unwrap();
        assert_eq!(f.rating, Some(1));
        assert_eq!(f.subject.unwrap(), ["a"]);
        assert!(out.contains("xmp:CreatorTool='digiKam'"));
        assert!(out.contains("xmlns:dc=\"http://purl.org/dc/elements/1.1/\""));
        assert!(!out.contains("xmp:Rating='3'"));
    }

    #[test]
    fn writes_a_new_packet() {
        let out = new_packet(&Edits {
            rating: Some(4),
            caption: Some("Hello".into()),
            ..Default::default()
        })
        .unwrap();
        assert!(out.starts_with("<?xpacket begin='\u{feff}'"));
        let f = read_fields(&out).unwrap();
        assert_eq!((f.rating, f.caption.as_deref()), (Some(4), Some("Hello")));
    }

    #[test]
    fn uses_another_prefix_when_the_usual_one_is_taken() {
        let src = "<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#' xmlns:dc='urn:other'><rdf:Description rdf:about=''></rdf:Description></rdf:RDF>";
        let out = update_packet(
            src,
            &Edits {
                caption: Some("c".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(out.contains("xmlns:dc2=\"http://purl.org/dc/elements/1.1/\""));
        assert_eq!(read_fields(&out).unwrap().caption.as_deref(), Some("c"));
    }

    #[test]
    fn adds_a_description_when_there_is_none_and_refuses_non_xmp() {
        let src = "<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>\n</rdf:RDF>";
        let out = update_packet(
            src,
            &Edits {
                rating: Some(3),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(read_fields(&out).unwrap().rating, Some(3));
        assert!(
            update_packet(
                "<html></html>",
                &Edits {
                    rating: Some(1),
                    ..Default::default()
                }
            )
            .is_err()
        );
        assert!(
            update_packet(
                "<broken",
                &Edits {
                    rating: Some(1),
                    ..Default::default()
                }
            )
            .is_err()
        );
        assert!(
            update_packet(
                src,
                &Edits {
                    taken_at: Some("soon".into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
    }

    #[test]
    fn normalises_dates_and_coordinates() {
        assert_eq!(
            xmp_date_to_local("2021-07-04").as_deref(),
            Some("2021-07-04T00:00:00")
        );
        assert_eq!(
            xmp_date_to_local("2021:07:04 10:11:12").as_deref(),
            Some("2021-07-04T10:11:12")
        );
        assert_eq!(xmp_date_to_local("2021-13-04"), None);
        assert_eq!(xmp_date_to_local("0000-01-01"), None);
        assert_eq!(xmp_date_to_local("2021-07"), None);
        assert_eq!(parse_gps("-12.5"), Some(-12.5));
        assert_eq!(parse_gps("10,30,0S"), Some(-10.5));
        assert_eq!(parse_gps("10;30N"), None);
        assert_eq!(parse_gps("NaN"), None);
    }
}
