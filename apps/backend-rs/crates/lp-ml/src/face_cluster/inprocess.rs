//! In-process clustering: the face_cluster sidecar's `/cluster`, `/train` and
//! `/pca` on the Rust ports of HDBSCAN ([`super::hdbscan`]), sklearn's
//! MLPClassifier ([`super::mlp`]) and PCA ([`super::pca`]). The work runs on
//! the blocking pool, `LP_ML_FACE_CLUSTER_CONCURRENCY` (default 1, like the
//! single-threaded sidecar) calls at a time; HDBSCAN's distance loops and
//! the two MLP fits use rayon.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::{
    ClusterReply, ClusterRequest, FacePrediction, SidecarError, TrainReply, TrainRequest,
};
use ndarray::{Array2, ArrayView2};
use rayon::prelude::*;

use super::FaceClusterApi;
use super::hdbscan::{self, Params};
use super::mlp::Mlp;
use crate::slot::ModelSlot;
use crate::{Backend, MlContext, Service};

/// `train_faces` predicts the unknown faces in pages of 100.
const PREDICT_PAGE: usize = 100;

pub struct InProcess {
    /// No model: the slot gives the calls their concurrency limit and the
    /// service its `busy` / `last_used` status.
    fit: ModelSlot<()>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        InProcess {
            fit: ctx.slot(Service::FaceCluster, "face_cluster"),
        }
    }

    /// `f` on the blocking pool; its error is the sidecar's fit failure.
    async fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, SidecarError> {
        let out = self.fit.run("fit", || Ok(()), move |_| Ok(f())).await;
        // Nothing is kept between calls: report no model loaded.
        self.fit.unload();
        match out {
            Ok(r) => r.map_err(fit_failed),
            Err(e) => Err(crate::failed(
                Service::FaceCluster,
                format!("face_cluster task: {e:#}"),
            )),
        }
    }
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    /// Pure computation, no model files.
    fn ready(&self) -> bool {
        true
    }
}

/// The sidecar's `{"error": str(exception)}` 500.
fn fit_failed(msg: String) -> SidecarError {
    tracing::warn!(error = %msg, "face_cluster fit failed");
    crate::failed(Service::FaceCluster, msg)
}

/// Decoding the borrowed request: on a multi-thread runtime the worker hands
/// its other tasks off first (`block_in_place`).
fn off_runtime<T>(f: impl FnOnce() -> T) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(h) if h.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(f)
        }
        _ => f(),
    }
}

// The hex encodings are decoded before the hand-off to the blocking pool
// (in parallel), so the request's strings are not copied: at 50k faces they
// are ~400 MB against ~200 MB decoded.
#[async_trait]
impl FaceClusterApi for InProcess {
    async fn cluster(&self, req: &ClusterRequest) -> Result<ClusterReply, SidecarError> {
        let ids: Vec<i32> = req.faces.iter().map(|f| f.id).collect();
        if ids.is_empty() {
            return Ok(ClusterReply {
                ids,
                labels: Vec::new(),
            });
        }
        let (data, d) = off_runtime(|| {
            matrix(decode_all(req.faces.iter().map(|f| f.encoding.as_str()))?).map_err(fit_failed)
        })?;
        let params = Params {
            min_cluster_size: req.min_cluster_size as i64,
            min_samples: req.min_samples as i64,
            cluster_selection_epsilon: req.cluster_selection_epsilon,
        };
        let labels = self.run(move || hdbscan::labels(&data, d, &params)).await?;
        Ok(ClusterReply { ids, labels })
    }

    async fn train(&self, req: &TrainRequest) -> Result<TrainReply, SidecarError> {
        let data = off_runtime(|| {
            Ok::<_, SidecarError>(TrainData {
                known: decode_all(req.known.iter().map(|f| f.encoding.as_str()))?,
                known_ids: req.known.iter().map(|f| f.person_id as i64).collect(),
                clusters: decode_all(req.clusters.iter().map(|f| f.encoding.as_str()))?,
                cluster_ids: req.clusters.iter().map(|f| f.person_id as i64).collect(),
                unknown: decode_all(req.unknown.iter().map(|f| f.encoding.as_str()))?,
                unknown_ids: req.unknown.iter().map(|f| f.id).collect(),
            })
        })?;
        let predictions = self.run(move || train(data)).await?;
        Ok(TrainReply { predictions })
    }

    async fn pca(&self, encodings: &[String]) -> Result<Vec<[f64; 3]>, SidecarError> {
        if encodings.is_empty() {
            return Ok(Vec::new());
        }
        let rows = off_runtime(|| decode_all(encodings.iter().map(String::as_str)))?;
        self.run(move || {
            if rows.iter().any(|r| r.len() != rows[0].len()) {
                return Err(inhomogeneous(rows.len()));
            }
            check_finite(&rows, "PCA")?;
            let m = rows.len().min(rows[0].len());
            if m < 3 {
                return Err(format!(
                    "n_components=3 must be between 0 and min(n_samples, n_features)={m} with svd_solver='full'"
                ));
            }
            Ok(super::pca::pca_scores(&rows, 3)
                .into_iter()
                .map(|r| [r[0], r[1], r[2]])
                .collect())
        })
        .await
    }
}

/// Every encoding decoded (in parallel); the first bad one is the error.
fn decode_all<'a>(encodings: impl Iterator<Item = &'a str>) -> Result<Vec<Vec<f64>>, SidecarError> {
    let encodings: Vec<&str> = encodings.collect();
    encodings
        .par_iter()
        .map(|e| decode(e))
        .collect::<Result<Vec<_>, _>>()
        .map_err(fit_failed)
}

/// `np.frombuffer(bytes.fromhex(encoding))`: float64 little-endian.
pub fn decode(encoding: &str) -> Result<Vec<f64>, String> {
    let compact: String = encoding
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    let bytes = hex::decode(&compact)
        .map_err(|e| format!("non-hexadecimal number found in fromhex() arg: {e}"))?;
    if bytes.len() % 8 != 0 {
        return Err("buffer size must be a multiple of element size".into());
    }
    Ok(bytes
        .chunks_exact(8)
        .map(|c| f64::from_le_bytes(c.try_into().expect("8 bytes")))
        .collect())
}

fn inhomogeneous(n: usize) -> String {
    format!(
        "setting an array element with a sequence. The requested array has an inhomogeneous shape after 1 dimensions. The detected shape was ({n},) + inhomogeneous part."
    )
}

/// The rows as one row-major matrix (`np.array([...])`), each row freed as
/// it is copied.
fn matrix(rows: Vec<Vec<f64>>) -> Result<(Vec<f64>, usize), String> {
    let d = rows.first().map_or(0, Vec::len);
    if rows.iter().any(|r| r.len() != d) {
        return Err(inhomogeneous(rows.len()));
    }
    let mut flat = Vec::with_capacity(rows.len() * d);
    for r in rows {
        flat.extend_from_slice(&r);
    }
    Ok((flat, d))
}

const NAN_HELP: &str = "does not accept missing values encoded as NaN natively. For supervised \
learning, you might want to consider sklearn.ensemble.HistGradientBoostingClassifier and Regressor \
which accept missing values encoded as NaNs natively. Alternatively, it is possible to preprocess \
the data, for instance by using an imputer transformer in a pipeline or drop samples with missing \
values. See https://scikit-learn.org/stable/modules/impute.html You can find a list of all \
estimators that handle NaN values at the following page: \
https://scikit-learn.org/stable/modules/impute.html#estimators-that-handle-nan-values";

/// sklearn's `check_array(ensure_all_finite=True)`: the first non-finite
/// value (in row-major order) names the error.
fn check_finite(rows: &[Vec<f64>], estimator: &str) -> Result<(), String> {
    match rows.iter().flatten().find(|v| !v.is_finite()) {
        None => Ok(()),
        Some(v) if v.is_nan() => Err(format!("Input X contains NaN.\n{estimator} {NAN_HELP}")),
        Some(_) => {
            Err("Input X contains infinity or a value too large for dtype('float64').".into())
        }
    }
}

/// `face_classify.filter_data`: keep the entries as long as the first.
fn filter_data<T: Copy>(rows: Vec<Vec<f64>>, ids: &[T]) -> (Vec<Vec<f64>>, Vec<T>) {
    let expected = rows.first().map_or(0, Vec::len);
    let mut kept = Vec::with_capacity(rows.len());
    let mut kept_ids = Vec::with_capacity(rows.len());
    for (i, (row, id)) in rows.into_iter().zip(ids).enumerate() {
        if row.len() == expected {
            kept.push(row);
            kept_ids.push(*id);
        } else {
            tracing::info!(
                entry = i,
                len = row.len(),
                expected,
                "face_cluster: discarding encoding of another length"
            );
        }
    }
    (kept, kept_ids)
}

fn to_array(rows: &[Vec<f64>]) -> Array2<f64> {
    let d = rows.first().map_or(0, Vec::len);
    let mut a = Array2::zeros((rows.len(), d));
    for (mut dst, src) in a.rows_mut().into_iter().zip(rows) {
        dst.assign(&ArrayView2::from_shape((1, d), src).expect("row").row(0));
    }
    a
}

/// `most_probable_class`: the LAST class whose probability equals the
/// highest one (of all columns), else 0.
fn most_probable_class(classes: &[i64], probabilities: &[f64]) -> (i64, f64) {
    let highest = probabilities
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, |a, b| if b > a { b } else { a });
    let mut class = 0;
    for (i, c) in classes.iter().enumerate() {
        if probabilities.get(i) == Some(&highest) {
            class = *c;
        }
    }
    (class, highest)
}

/// The decoded `/train` request.
struct TrainData {
    known: Vec<Vec<f64>>,
    known_ids: Vec<i64>,
    clusters: Vec<Vec<f64>>,
    cluster_ids: Vec<i64>,
    unknown: Vec<Vec<f64>>,
    unknown_ids: Vec<i32>,
}

/// The sidecar's `_train` (Django's `train_faces` minus the ORM).
fn train(req: TrainData) -> Result<Vec<FacePrediction>, String> {
    let TrainData {
        mut known,
        mut known_ids,
        clusters,
        cluster_ids,
        unknown,
        unknown_ids,
    } = req;
    if known.iter().any(|r| r.len() != known[0].len()) {
        return Err(inhomogeneous(known.len()));
    }
    // The fits validate their input before the unknown faces are read.
    check_finite(&known, "MLPClassifier")?;
    let known_x = to_array(&known);
    let n_known = known.len();

    known.extend(clusters);
    known_ids.extend(cluster_ids);
    let (all, all_ids) = filter_data(known, &known_ids);
    if all.is_empty() {
        return Err("Expected 2D array, got 1D array instead:\narray=[].\nReshape your data either using array.reshape(-1, 1) if your data has a single feature or array.reshape(1, -1) if it contains a single sample.".into());
    }
    check_finite(&all, "MLPClassifier")?;
    let all_x = to_array(&all);
    drop(all);

    let (unknown, unknown_ids) = filter_data(unknown, &unknown_ids);
    if unknown.is_empty() {
        // Nothing to predict: the fits would only be thrown away.
        return Ok(Vec::new());
    }

    let (classifier, cluster_classifier) = rayon::join(
        || (n_known > 0).then(|| Mlp::fit(known_x.view(), &known_ids[..n_known])),
        || Mlp::fit(all_x.view(), &all_ids),
    );
    let classifier = classifier.transpose()?;
    let cluster_classifier = cluster_classifier?;

    let mut predictions = Vec::with_capacity(unknown.len());
    for (page, page_ids) in unknown
        .chunks(PREDICT_PAGE)
        .zip(unknown_ids.chunks(PREDICT_PAGE))
    {
        check_finite(page, "MLPClassifier")?;
        let x = to_array(page);
        if x.ncols() != all_x.ncols() {
            return Err(format!(
                "X has {} features, but MLPClassifier is expecting {} features as input.",
                x.ncols(),
                all_x.ncols()
            ));
        }
        let cluster_p = cluster_classifier.predict_proba(x.view());
        let class_p = classifier.as_ref().map(|c| c.predict_proba(x.view()));
        for (r, id) in page_ids.iter().enumerate() {
            let (cluster_person, cluster_probability) = most_probable_class(
                &cluster_classifier.classes,
                cluster_p.row(r).as_slice().expect("row"),
            );
            let (classification_person, classification_probability) = match (&classifier, &class_p)
            {
                (Some(c), Some(p)) => {
                    most_probable_class(&c.classes, p.row(r).as_slice().expect("row"))
                }
                _ => (0, 0.0),
            };
            predictions.push(FacePrediction {
                id: *id,
                cluster_person_id: cluster_person as i32,
                cluster_probability,
                // `int(p) if p else None`: person 0 counts as none.
                classification_person_id: (classification_person != 0)
                    .then_some(classification_person as i32),
                classification_probability,
            });
        }
    }
    Ok(predictions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn most_probable_class_is_the_last_maximum() {
        assert_eq!(most_probable_class(&[3, 5, 9], &[0.4, 0.2, 0.4]), (9, 0.4));
        // One class, two logistic columns: the second column is no class.
        assert_eq!(most_probable_class(&[7], &[0.1, 0.9]), (0, 0.9));
        assert_eq!(most_probable_class(&[7], &[0.9, 0.1]), (7, 0.9));
    }

    #[test]
    fn decode_is_float64_le() {
        let hex: String = [1.5f64, -2.0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(decode(&hex).unwrap(), vec![1.5, -2.0]);
        assert!(decode("zz").is_err());
        assert!(decode("0011").is_err());
    }
}
