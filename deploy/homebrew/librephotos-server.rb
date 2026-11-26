cask "librephotos-server" do
  version "0.0.0"
  sha256 :no_check

  url "https://github.com/LibrePhotos/librephotos/releases/download/#{version}/LibrePhotos-Server-#{version}-macos-arm64.dmg", verified: "github.com/LibrePhotos/librephotos/"
  name "LibrePhotos Server"
  desc "Self-hosted photo library with faces, places and search"
  homepage "https://librephotos.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :sonoma"

  app "LibrePhotos Server.app"

  uninstall quit:      "com.librephotos.server",
            launchctl: "com.librephotos.server",
            delete:    "/Applications/LibrePhotos Server.app-old"

  zap trash: [
    "~/Library/Application Support/LibrePhotos",
    "~/Library/LaunchAgents/com.librephotos.server.plist",
  ]
end
