//! Windows Imaging Component decoding: JPEG, PNG, GIF, BMP, TIFF, WebP, HEIC/HEIF, AVIF, JXL and
//! RAW (with the Store codecs installed). Scaled JPEG decode through `IWICBitmapSourceTransform`
//! (DCT scaling: a 298 MP JPEG never materialises at full size for `screen`), embedded frame
//! thumbnails, and Windows shell thumbnails for videos.

use std::path::Path;

use windows::Win32::Foundation::{GENERIC_READ, SIZE};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits,
    GetObjectW, HBITMAP, ReleaseDC,
};
use windows::Win32::Graphics::Imaging::*;
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PropVariantClear, PropVariantToUInt16,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_BIGGERSIZEOK,
    SIIGBF_INCACHEONLY, SIIGBF_THUMBNAILONLY,
};
use windows::core::{GUID, HSTRING, Interface, PCWSTR, w};

use crate::orient;
use crate::pixels::{PixFmt, Pixels, fit};

thread_local! {
    // COM is initialised (MTA) once per thread that touches WIC, and the factory reused.
    static FACTORY: Option<IWICImagingFactory> = init_factory();
}

fn init_factory() -> Option<IWICImagingFactory> {
    unsafe {
        // S_FALSE / RPC_E_CHANGED_MODE just mean COM is already up on this thread.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()
    }
}

pub fn factory() -> Result<IWICImagingFactory, String> {
    FACTORY
        .with(|f| f.clone())
        .ok_or_else(|| "WIC is not available".to_string())
}

fn err(e: windows::core::Error) -> String {
    format!("WIC: {} ({:#010x})", e.message(), e.code().0)
}

/// An opened image: first frame, stored size and EXIF orientation.
pub struct Source {
    pub frame: IWICBitmapFrameDecode,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
    pub container: GUID,
    _decoder: IWICBitmapDecoder,
}

impl Source {
    pub fn oriented_dims(&self) -> (u32, u32) {
        orient::oriented_dims(self.width, self.height, self.orientation)
    }

    pub fn is_heif(&self) -> bool {
        self.container == GUID_ContainerFormatHeif
    }
}

pub fn open_file(path: &Path) -> Result<Source, String> {
    let f = factory()?;
    unsafe {
        let dec = f
            .CreateDecoderFromFilename(
                &HSTRING::from(path),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )
            .map_err(err)?;
        from_decoder(dec)
    }
}

/// Run `f` on an image decoded from memory (RAW previews). The stream borrows `bytes`, so every
/// WIC object is dropped before this returns.
pub fn with_memory<T>(
    bytes: &[u8],
    f: impl FnOnce(&Source) -> Result<T, String>,
) -> Result<T, String> {
    let fac = factory()?;
    unsafe {
        let stream = fac.CreateStream().map_err(err)?;
        stream.InitializeFromMemory(bytes).map_err(err)?;
        let dec = fac
            .CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)
            .map_err(err)?;
        let src = from_decoder(dec)?;
        let r = f(&src);
        drop(src);
        drop(stream);
        r
    }
}

unsafe fn from_decoder(dec: IWICBitmapDecoder) -> Result<Source, String> {
    unsafe {
        let frame = dec.GetFrame(0).map_err(err)?;
        let (mut w, mut h) = (0, 0);
        frame.GetSize(&mut w, &mut h).map_err(err)?;
        let container = dec.GetContainerFormat().unwrap_or_default();
        let orientation = orientation(&frame);
        Ok(Source {
            frame,
            width: w,
            height: h,
            orientation,
            container,
            _decoder: dec,
        })
    }
}

unsafe fn read_u16(q: &IWICMetadataQueryReader, name: PCWSTR) -> Option<u16> {
    unsafe {
        let mut pv = PROPVARIANT::default();
        q.GetMetadataByName(name, &mut pv).ok()?;
        let v = PropVariantToUInt16(&pv).ok();
        let _ = PropVariantClear(&mut pv);
        v
    }
}

unsafe fn orientation(frame: &IWICBitmapFrameDecode) -> u16 {
    unsafe {
        let Ok(q) = frame.GetMetadataQueryReader() else {
            return 1;
        };
        for name in [
            w!("System.Photo.Orientation"),
            w!("/app1/ifd/{ushort=274}"),
            w!("/ifd/{ushort=274}"),
        ] {
            if let Some(v) = read_u16(&q, name).filter(|v| (1..=8).contains(v)) {
                return v;
            }
        }
        1
    }
}

unsafe fn has_alpha(fac: &IWICImagingFactory, fmt: &GUID) -> bool {
    unsafe {
        fac.CreateComponentInfo(fmt)
            .and_then(|i| i.cast::<IWICPixelFormatInfo2>())
            .and_then(|i| i.SupportsTransparency())
            .map(|b| b.as_bool())
            .unwrap_or(false)
    }
}

/// Decode `src` to fit the display-oriented box `bw`x`bh`, orientation applied.
pub fn render(src: &Source, bw: u32, bh: u32) -> Result<Pixels, String> {
    let o = src.orientation;
    let (sbw, sbh) = if orient::swaps_axes(o) {
        (bh, bw)
    } else {
        (bw, bh)
    };
    Ok(orient::apply(render_stored(src, sbw, sbh)?, o))
}

/// Decode `src` to fit `sbw`x`sbh` in its stored orientation (no orientation applied).
pub fn render_stored(src: &Source, sbw: u32, sbh: u32) -> Result<Pixels, String> {
    let (tw, th) = fit(src.width, src.height, sbw, sbh);
    let fac = factory()?;
    Ok(unsafe {
        let source: IWICBitmapSource = src.frame.cast().map_err(err)?;
        match dct_scaled(&src.frame, src.width, src.height, tw, th)? {
            // Slightly under the target (within DCT_TOLERANCE): serve as decoded, no resample.
            Some(p) if p.width <= tw => p,
            Some(p) => p.resize(tw, th)?,
            None => copy_scaled(&fac, &source, src.width, src.height, tw, th)?,
        }
    })
}

/// The frame's embedded thumbnail (EXIF / HEIF thumbnail item), oriented and fitted to `edge`.
/// `None` when there is none or it is tiny.
pub fn embedded_thumbnail(src: &Source, edge: u32) -> Option<Pixels> {
    let fac = factory().ok()?;
    unsafe {
        let t = src.frame.GetThumbnail().ok()?;
        let (mut w, mut h) = (0, 0);
        t.GetSize(&mut w, &mut h).ok()?;
        if w.max(h) < 160 {
            return None;
        }
        let (tw, th) = fit(w, h, edge, edge);
        let px = copy_scaled(&fac, &t, w, h, tw, th).ok()?;
        Some(orient::apply(px, src.orientation))
    }
}

/// A DCT-scaled decode may come out this much smaller than the target box and still be used:
/// a 1/2 decode of a 3840x2560 JPEG (1920x1280) for a 2160x1440 target saves ~40% of the time.
const DCT_TOLERANCE: f64 = 0.85;

/// Native JPEG downscale by 1/2, 1/4 or 1/8 during decode (only for 24bpp BGR sources, i.e. JPEG).
/// Returns pixels at least `DCT_TOLERANCE` x `tw`x`th`, or `None` when the codec cannot do it.
unsafe fn dct_scaled(
    frame: &IWICBitmapFrameDecode,
    w: u32,
    h: u32,
    tw: u32,
    th: u32,
) -> Result<Option<Pixels>, String> {
    unsafe {
        if (tw, th) == (w, h) || frame.GetPixelFormat().map_err(err)? != GUID_WICPixelFormat24bppBGR
        {
            return Ok(None);
        }
        let Ok(t) = frame.cast::<IWICBitmapSourceTransform>() else {
            return Ok(None);
        };
        for s in [8u32, 4, 2] {
            let (mut cw, mut ch) = (w.div_ceil(s), h.div_ceil(s));
            let enough = |cw: u32, ch: u32| {
                cw as f64 >= tw as f64 * DCT_TOLERANCE && ch as f64 >= th as f64 * DCT_TOLERANCE
            };
            if !enough(cw, ch) {
                continue;
            }
            if t.GetClosestSize(&mut cw, &mut ch).is_err() || !enough(cw, ch) || cw >= w {
                continue;
            }
            let mut fmt = GUID_WICPixelFormat24bppBGR;
            if t.GetClosestPixelFormat(&mut fmt).is_err() || fmt != GUID_WICPixelFormat24bppBGR {
                return Ok(None);
            }
            let stride = (cw * 3).next_multiple_of(4);
            let mut buf = vec![0u8; stride as usize * ch as usize];
            t.CopyPixels(
                std::ptr::null(),
                cw,
                ch,
                &fmt,
                WICBitmapTransformRotate0,
                stride,
                &mut buf,
            )
            .map_err(err)?;
            return Ok(Some(Pixels {
                width: cw,
                height: ch,
                format: PixFmt::Bgr8,
                data: unpad(buf, cw * 3, stride, ch),
            }));
        }
        Ok(None)
    }
}

fn unpad(buf: Vec<u8>, row: u32, stride: u32, h: u32) -> Vec<u8> {
    if row == stride {
        return buf;
    }
    let mut out = Vec::with_capacity(row as usize * h as usize);
    for r in buf.chunks_exact(stride as usize) {
        out.extend_from_slice(&r[..row as usize]);
    }
    out
}

const SCALE_FIRST: [GUID; 6] = [
    GUID_WICPixelFormat24bppBGR,
    GUID_WICPixelFormat32bppBGR,
    GUID_WICPixelFormat32bppBGRA,
    GUID_WICPixelFormat32bppPBGRA,
    GUID_WICPixelFormat32bppRGBA,
    GUID_WICPixelFormat24bppRGB,
];

/// Scale (Fant) and convert `source` to BGR24 (opaque) or RGBA32 (alpha), then copy out.
unsafe fn copy_scaled(
    fac: &IWICImagingFactory,
    source: &IWICBitmapSource,
    w: u32,
    h: u32,
    tw: u32,
    th: u32,
) -> Result<Pixels, String> {
    unsafe {
        let native = source.GetPixelFormat().map_err(err)?;
        let alpha = has_alpha(fac, &native);
        let (dst, pf) = if alpha {
            (GUID_WICPixelFormat32bppRGBA, PixFmt::Rgba8)
        } else {
            (GUID_WICPixelFormat24bppBGR, PixFmt::Bgr8)
        };
        let scale = |cur: IWICBitmapSource| -> Result<IWICBitmapSource, String> {
            if (tw, th) == (w, h) {
                return Ok(cur);
            }
            let s = fac.CreateBitmapScaler().map_err(err)?;
            s.Initialize(&cur, tw, th, WICBitmapInterpolationModeFant)
                .map_err(err)?;
            s.cast().map_err(err)
        };
        let convert = |cur: IWICBitmapSource| -> Result<IWICBitmapSource, String> {
            if cur.GetPixelFormat().map_err(err)? == dst {
                return Ok(cur);
            }
            let c = fac.CreateFormatConverter().map_err(err)?;
            c.Initialize(
                &cur,
                &dst,
                WICBitmapDitherTypeNone,
                None::<&IWICPalette>,
                0.0,
                WICBitmapPaletteTypeCustom,
            )
            .map_err(err)?;
            c.cast().map_err(err)
        };
        let cur = if SCALE_FIRST.contains(&native) {
            convert(scale(source.clone())?)?
        } else {
            scale(convert(source.clone())?)?
        };
        let (mut ow, mut oh) = (0, 0);
        cur.GetSize(&mut ow, &mut oh).map_err(err)?;
        let bpp = pf.bytes_per_pixel() as u32;
        let stride = (ow * bpp).next_multiple_of(4);
        let len = stride as usize * oh as usize;
        if len > 1 << 31 {
            return Err(format!("image too large to decode ({ow}x{oh})"));
        }
        let mut buf = vec![0u8; len];
        cur.CopyPixels(std::ptr::null(), stride, &mut buf)
            .map_err(err)?;
        Ok(Pixels {
            width: ow,
            height: oh,
            format: pf,
            data: unpad(buf, ow * bpp, stride, oh),
        })
    }
}

/// Windows shell thumbnail (thumbnail cache / Media Foundation for videos), fitted to `edge`.
/// Shell thumbnails are already oriented.
pub fn shell_thumbnail(path: &Path, edge: u32) -> Result<Pixels, String> {
    shell_image(path, edge, SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK)
}

/// Only what Explorer's thumbnail cache already holds (a few ms, no decode); `None` on a miss.
pub fn shell_cached_thumbnail(path: &Path, edge: u32) -> Option<Pixels> {
    shell_image(
        path,
        edge,
        SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK | SIIGBF_INCACHEONLY,
    )
    .ok()
}

fn shell_image(path: &Path, edge: u32, flags: SIIGBF) -> Result<Pixels, String> {
    factory()?; // COM up on this thread
    unsafe {
        // The shell parser wants backslashes.
        let p = HSTRING::from(path.to_string_lossy().replace('/', "\\"));
        let item: IShellItemImageFactory = SHCreateItemFromParsingName(&p, None).map_err(err)?;
        let size = SIZE {
            cx: edge as i32,
            cy: edge as i32,
        };
        let hbmp = item.GetImage(size, flags).map_err(err)?;
        let px = hbitmap_pixels(hbmp);
        let _ = DeleteObject(hbmp.into());
        px?.fit_into(edge, edge)
    }
}

unsafe fn hbitmap_pixels(h: HBITMAP) -> Result<Pixels, String> {
    unsafe {
        let mut bm = BITMAP::default();
        if GetObjectW(
            h.into(),
            size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut BITMAP as *mut _),
        ) == 0
        {
            return Err("shell thumbnail: GetObject failed".into());
        }
        let (w, ht) = (bm.bmWidth, bm.bmHeight.abs());
        if w <= 0 || ht <= 0 {
            return Err("shell thumbnail is empty".into());
        }
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -ht, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; w as usize * ht as usize * 4];
        let dc = GetDC(None);
        let lines = GetDIBits(
            dc,
            h,
            0,
            ht as u32,
            Some(buf.as_mut_ptr().cast()),
            &mut bi,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, dc);
        if lines == 0 {
            return Err("shell thumbnail: GetDIBits failed".into());
        }
        Ok(Pixels {
            width: w as u32,
            height: ht as u32,
            format: PixFmt::Bgrx8,
            data: buf,
        })
    }
}

/// JPEG through the WIC encoder (libjpeg-turbo class speed), for opaque pixels.
pub fn encode_jpeg(p: &Pixels, quality: f32) -> Result<Vec<u8>, String> {
    encode_jpeg_with(p, quality, false)
}

/// [`encode_jpeg`], optionally without chroma subsampling (4:4:4): pictures cut into tiles need
/// it, since 4:2:0 chroma is reconstructed differently at a tile's edge than inside it.
pub fn encode_jpeg_with(p: &Pixels, quality: f32, chroma444: bool) -> Result<Vec<u8>, String> {
    use std::mem::ManuallyDrop;
    use windows::Win32::System::Com::STREAM_SEEK_CUR;
    use windows::Win32::System::Com::StructuredStorage::{IPropertyBag2, PROPBAG2};
    use windows::Win32::System::Variant::{
        VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_R4, VT_UI1,
    };

    // WIC's JPEG encoder takes BGR24.
    let bgr: std::borrow::Cow<[u8]> = match p.format {
        PixFmt::Bgr8 => p.data.as_slice().into(),
        PixFmt::Rgb8 => p
            .data
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|c| [c[2], c[1], c[0]])
            .collect::<Vec<_>>()
            .into(),
        PixFmt::Rgba8 => p
            .data
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|c| [c[2], c[1], c[0]])
            .collect::<Vec<_>>()
            .into(),
        PixFmt::Bgrx8 => p
            .data
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|c| [c[0], c[1], c[2]])
            .collect::<Vec<_>>()
            .into(),
    };
    let fac = factory()?;
    // Worst case for q<=95 4:2:0 is well under the raw size; the encoder fails cleanly if not.
    let mut out = vec![0u8; bgr.len() + (1 << 20)];
    unsafe {
        let stream = fac.CreateStream().map_err(err)?;
        stream.InitializeFromMemory(&out).map_err(err)?;
        let enc = fac
            .CreateEncoder(&GUID_ContainerFormatJpeg, std::ptr::null())
            .map_err(err)?;
        enc.Initialize(&stream, WICBitmapEncoderNoCache)
            .map_err(err)?;
        let mut frame: Option<IWICBitmapFrameEncode> = None;
        let mut bag: Option<IPropertyBag2> = None;
        enc.CreateNewFrame(&mut frame, &mut bag).map_err(err)?;
        let frame = frame.ok_or("WIC: no frame encoder")?;
        if let Some(bag) = &bag {
            let mut name: Vec<u16> = "ImageQuality\0".encode_utf16().collect();
            let opt = PROPBAG2 {
                pstrName: windows::core::PWSTR(name.as_mut_ptr()),
                ..Default::default()
            };
            let val = VARIANT {
                Anonymous: VARIANT_0 {
                    Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                        vt: VT_R4,
                        wReserved1: 0,
                        wReserved2: 0,
                        wReserved3: 0,
                        Anonymous: VARIANT_0_0_0 { fltVal: quality },
                    }),
                },
            };
            bag.Write(1, &opt, &val).map_err(err)?;
            if chroma444 {
                let mut name: Vec<u16> = "JpegYCrCbSubsampling\0".encode_utf16().collect();
                let opt = PROPBAG2 {
                    pstrName: windows::core::PWSTR(name.as_mut_ptr()),
                    ..Default::default()
                };
                let val = VARIANT {
                    Anonymous: VARIANT_0 {
                        Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                            vt: VT_UI1,
                            wReserved1: 0,
                            wReserved2: 0,
                            wReserved3: 0,
                            Anonymous: VARIANT_0_0_0 {
                                bVal: WICJpegYCrCbSubsampling444.0 as u8,
                            },
                        }),
                    },
                };
                bag.Write(1, &opt, &val).map_err(err)?;
            }
        }
        frame.Initialize(bag.as_ref()).map_err(err)?;
        frame.SetSize(p.width, p.height).map_err(err)?;
        let mut fmt = GUID_WICPixelFormat24bppBGR;
        frame.SetPixelFormat(&mut fmt).map_err(err)?;
        if fmt != GUID_WICPixelFormat24bppBGR {
            return Err("WIC JPEG encoder refused BGR24".into());
        }
        frame
            .WritePixels(p.height, p.width * 3, &bgr)
            .map_err(err)?;
        frame.Commit().map_err(err)?;
        enc.Commit().map_err(err)?;
        let mut pos = 0u64;
        stream
            .Seek(0, STREAM_SEEK_CUR, Some(&mut pos))
            .map_err(err)?;
        drop(enc);
        drop(stream);
        out.truncate(pos as usize);
    }
    // The buffer was sized for the worst case (raw size + 1 MB): give the rest back, or every
    // cached JPEG keeps megabytes committed that the caches' byte budgets never see.
    out.shrink_to_fit();
    Ok(out)
}
