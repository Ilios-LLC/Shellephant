#!/bin/zsh
set -e
cd "$(dirname "$0")"

rm -rf icon.iconset
mkdir icon.iconset

for sz in 16 32 64 128 256 512 1024; do
  magick -background none -density 1200 icon.svg -resize "${sz}x${sz}" "icon.iconset/icon_${sz}x${sz}.png"
done

# Retarget the extras that iconutil expects, pulling from the right pixel size.
cp icon.iconset/icon_32x32.png icon.iconset/icon_16x16@2x.png
cp icon.iconset/icon_64x64.png icon.iconset/icon_32x32@2x.png
cp icon.iconset/icon_256x256.png icon.iconset/icon_128x128@2x.png
cp icon.iconset/icon_512x512.png icon.iconset/icon_256x256@2x.png
cp icon.iconset/icon_1024x1024.png icon.iconset/icon_512x512@2x.png

# iconutil only accepts a canonical set, so remove the ones it doesn't want.
rm icon.iconset/icon_64x64.png icon.iconset/icon_1024x1024.png

# Main app icon lives next to this script.
magick -background none -density 1200 icon.svg -resize 1024x1024 icon.png

iconutil -c icns icon.iconset -o icon.icns

echo "Built icon.png (1024x1024) and icon.icns"
file icon.png icon.icns
