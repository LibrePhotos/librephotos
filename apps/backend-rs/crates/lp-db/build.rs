fn main() {
    // sqlx::migrate! embeds the files; rebuild when one is added or edited.
    println!("cargo:rerun-if-changed=../../migrations");
}
