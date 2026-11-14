//! django-cryptography `encrypt(CharField)` columns (`User.nextcloud_app_password`,
//! the SMTP secret): `pickle.dumps(str)` encrypted with a Fernet variant.
//!
//! Layout: `0x80 | u64 BE timestamp | 16-byte IV | AES-256-CBC(PKCS7) | HMAC-SHA256`.
//! AES key = PBKDF2-HMAC-SHA256(SECRET_KEY, salt "django-cryptography", 30000, 32);
//! the HMAC key is SECRET_KEY itself and covers everything before it.
//! Rows Rust writes must decrypt in Django (NOT NULL bytea, even for "").

use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("token too short")]
    TooShort,
    #[error("unsupported version byte")]
    Version,
    #[error("bad signature")]
    Signature,
    #[error("bad padding")]
    Padding,
    #[error("unsupported pickle payload")]
    Pickle,
}

pub struct DjangoCrypto {
    aes_key: [u8; 32],
    hmac_key: Vec<u8>,
}

impl DjangoCrypto {
    pub fn new(secret_key: &str) -> Self {
        let mut aes_key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<Sha256>(
            secret_key.as_bytes(),
            b"django-cryptography",
            30000,
            &mut aes_key,
        );
        DjangoCrypto {
            aes_key,
            hmac_key: secret_key.as_bytes().to_vec(),
        }
    }

    pub fn encrypt_str(&self, value: &str) -> Vec<u8> {
        let mut iv = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut iv);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        self.encrypt_bytes_at(&pickle_str(value), now, iv)
    }

    fn encrypt_bytes_at(&self, plain: &[u8], timestamp: u64, iv: [u8; 16]) -> Vec<u8> {
        let ct = Aes256CbcEnc::new(&self.aes_key.into(), &iv.into())
            .encrypt_padded_vec_mut::<Pkcs7>(plain);
        let mut out = Vec::with_capacity(1 + 8 + 16 + ct.len() + 32);
        out.push(0x80);
        out.extend_from_slice(&timestamp.to_be_bytes());
        out.extend_from_slice(&iv);
        out.extend_from_slice(&ct);
        let mut mac = HmacSha256::new_from_slice(&self.hmac_key).expect("any key length");
        mac.update(&out);
        out.extend_from_slice(&mac.finalize().into_bytes());
        out
    }

    pub fn decrypt_str(&self, token: &[u8]) -> Result<String, CryptoError> {
        if token.len() < 1 + 8 + 16 + 16 + 32 {
            return Err(CryptoError::TooShort);
        }
        if token[0] != 0x80 {
            return Err(CryptoError::Version);
        }
        let (signed, sig) = token.split_at(token.len() - 32);
        let mut mac = HmacSha256::new_from_slice(&self.hmac_key).expect("any key length");
        mac.update(signed);
        mac.verify_slice(sig).map_err(|_| CryptoError::Signature)?;
        let iv: [u8; 16] = signed[9..25].try_into().expect("16 bytes");
        let plain = Aes256CbcDec::new(&self.aes_key.into(), &iv.into())
            .decrypt_padded_vec_mut::<Pkcs7>(&signed[25..])
            .map_err(|_| CryptoError::Padding)?;
        unpickle_str(&plain)
    }
}

/// `pickle.dumps(s)` (protocol 4, CPython's default) for a str.
fn pickle_str(s: &str) -> Vec<u8> {
    let data = s.as_bytes();
    let mut body = Vec::with_capacity(data.len() + 16);
    if data.len() < 256 {
        body.push(0x8c); // SHORT_BINUNICODE
        body.push(data.len() as u8);
    } else {
        body.push(0x58); // BINUNICODE
        body.extend_from_slice(&(data.len() as u32).to_le_bytes());
    }
    body.extend_from_slice(data);
    body.push(0x94); // MEMOIZE
    body.push(b'.'); // STOP
    let mut out = vec![0x80, 0x04];
    if body.len() >= 4 {
        out.push(0x95); // FRAME
        out.extend_from_slice(&(body.len() as u64).to_le_bytes());
    }
    out.extend_from_slice(&body);
    out
}

fn unpickle_str(p: &[u8]) -> Result<String, CryptoError> {
    let mut i = 0;
    if p.get(i) == Some(&0x80) {
        i += 2;
    }
    if p.get(i) == Some(&0x95) {
        i += 9;
    }
    let (len, start) = match p.get(i) {
        Some(0x8c) => (*p.get(i + 1).ok_or(CryptoError::Pickle)? as usize, i + 2),
        Some(0x58) => {
            let b: [u8; 4] = p
                .get(i + 1..i + 5)
                .ok_or(CryptoError::Pickle)?
                .try_into()
                .map_err(|_| CryptoError::Pickle)?;
            (u32::from_le_bytes(b) as usize, i + 5)
        }
        _ => return Err(CryptoError::Pickle),
    };
    let bytes = p.get(start..start + len).ok_or(CryptoError::Pickle)?;
    String::from_utf8(bytes.to_vec()).map_err(|_| CryptoError::Pickle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pickle_matches_cpython() {
        assert_eq!(
            hex::encode(pickle_str("")),
            "80049504000000000000008c00942e"
        );
        assert_eq!(
            hex::encode(pickle_str("abc")),
            "80049507000000000000008c03616263942e"
        );
        assert_eq!(
            unpickle_str(&pickle_str(&"x".repeat(300))).unwrap(),
            "x".repeat(300)
        );
    }

    #[test]
    fn decrypts_django_value() {
        // User.nextcloud_app_password of a Django-created user, SECRET_KEY=rust-bench-secret.
        let token = hex::decode("80000000006abbb2c0edca681af39ad3434d55c94a4d3b60674a8e523ca7b2776ae41c141f41b70397b7d61bc7a2b7de3360642c22506fde07c738866845bbb680dd99f16e90be5b4f").unwrap();
        let c = DjangoCrypto::new("rust-bench-secret");
        assert_eq!(c.decrypt_str(&token).unwrap(), "");
        let mine = c.encrypt_str("s3cret");
        assert_eq!(c.decrypt_str(&mine).unwrap(), "s3cret");
        assert!(DjangoCrypto::new("other").decrypt_str(&mine).is_err());
    }
}
