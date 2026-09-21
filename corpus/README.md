# Licensed corpus

`sources.json` contains 40 Wikimedia Commons source records: original page, download URL, author, license and collection search group. The downloaded images are **not committed**. Run `npm run corpus` to retrieve and normalize them into ignored `data/corpus/`; a runtime checksum file is generated there.

The collection spans animals (fox/wolf/dog/bear and difficult distractors), food/drink, landscapes and vehicles. Search results include photographs and some artwork/objects. `curationGroup` is a discovery hint, **not a verified species label**. It is never sent to a model or used for ranking. Model input consists only of normalized image bytes. Evaluation targets were selected by inspecting a contact sheet separately.

Every source is licensed CC BY, CC BY-SA or public domain/CC0 as reported by its Commons metadata. Follow the exact source record's license and attribution when reusing a photo, including share-alike requirements for adaptations. The project's MIT license applies to code, not third-party imagery. Normalization strips metadata and resizes to at most 640 pixels. Source-page links remain the attribution record; download availability can change.

The seed also creates **one uniform gray control image**, clearly distinguished from the 40 external images. It tests the model's uncertainty path, is not an ordinary photograph, and has no positive retrieval label.

Primary references: [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia), [Commons licensing](https://commons.wikimedia.org/wiki/Commons:Licensing). The brief suggests Unsplash/Pexels; Commons is used here because each file provides an explicit reproducible license and attribution record.
