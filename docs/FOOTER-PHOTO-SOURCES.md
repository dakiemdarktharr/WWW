# Footer photographic collage

The final asset is `public/art/kivuno-flower-collage.webp` (3200 × 1800). It is composed from **real photographs only**. No AI image generation, generative fill, learned segmentation, or model inference is involved.

The composition uses a 38.2% sky / 61.8% woodland division. Five floral species appear as hand-masked, overlapping crops at several scales. Additional leaves and branches are crops from the same credited originals. The forest and cloudy sky are real photographs. This is a decorative montage, not a botanical claim that the species inhabit the same forest.

## Attribution and license

The adapted collage is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), with arrangement and adaptation by Kivuno contributors (2026). The CC BY-SA 3.0 sources retain their original licenses and are incorporated into the adaptation under the later BY-SA version. CC0 inputs remain public domain. These terms apply to the photographic collage, not the application code, logo, or unrelated assets.

The public footer links to [`/art/photo-credits.html`](../public/art/photo-credits.html), containing photographer credits, source and license links, and the modifications disclosure.

| Original photograph                     | Photographer                    | Original license                                                | Source                                                                                                |
| --------------------------------------- | ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Clouds in the sky landscape.jpg         | Aammell                         | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)   | [Commons source](https://commons.wikimedia.org/wiki/File:Clouds_in_the_sky_landscape.jpg)             |
| Heavy fog above a forest (Unsplash).jpg | Thomas Griesbeck (jack_scorner) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)   | [Commons source](https://commons.wikimedia.org/wiki/File:Heavy_fog_above_a_forest_%28Unsplash%29.jpg) |
| Fritillaria meleagris flower.jpg        | Meneerke bloem                  | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Commons source](https://commons.wikimedia.org/wiki/File:Fritillaria_meleagris_flower.jpg)            |
| Tricyrtis hirta (flower s2).jpg         | Alpsdake                        | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Commons source](https://commons.wikimedia.org/wiki/File:Tricyrtis_hirta_%28flower_s2%29.jpg)         |
| Passiflora incarnata flower and bud.jpg | E.nielsen                       | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Commons source](https://commons.wikimedia.org/wiki/File:Passiflora_incarnata_flower_and_bud.jpg)     |
| Eryngium alpinum ENBLA05.jpg            | Enrico Blasutto                 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)   | [Commons source](https://commons.wikimedia.org/wiki/File:Eryngium_alpinum_ENBLA05.jpg)                |
| Helleborus foetidus flower.jpg          | Meneerke bloem                  | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Commons source](https://commons.wikimedia.org/wiki/File:Helleborus_foetidus_flower.jpg)              |

Sources and license metadata were checked against Wikimedia Commons `imageinfo/extmetadata` and the original file pages on 19 November 2026. The Thomas Griesbeck forest photograph was published on Unsplash in 2016 under CC0, before the site's license changed.

## Reproduction

Install Python, Pillow and numpy, then run from the repository:

```sh
python scripts/compose-footer.py
```

The script downloads the original files into `.local/footer-sources/` and verifies embedded SHA-256 digests before use. Downloads are not committed. Source masks use explicit polygon coordinates and RGB threshold arithmetic; the fixed random seed only positions repeated photographic crops.

Edits: crop, manual polygon/color masks, resize, mirror, rotation, layered collage, violet/lime color grade, depth haze, row-wise optical displacement, and 0.65px Gaussian blur. No flowers or foliage are procedurally drawn. The output is WebP quality 88.

Local audit evidence:

- `.local/footer-sources/contact-sheet.jpg`: seven original source photographs.
- `.local/footer-sources/*-grid.jpg`: manual mask planning views.
- `.local/footer-sources/cutout-*.png`: isolated photographic crops.
- `.local/footer-sources/collage-before-glass.webp`: composite before displacement and blur.
- `.local/footer-sources/collage-preview.jpg`: final 1600 × 900 review image.
- `.local/footer-sources/metadata.json`: Commons metadata snapshot used for verification.
