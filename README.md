# Elmo tool guide marketplace

This repository is the shared guide marketplace of **Elmo tool**. Every copy of the app reads
`index.json` from here and can download the guides in `guides/`.

## Sharing a guide

1. In Elmo tool, open **Guides → Marketplace → Publish a guide**, pick your guide and press **Download the guide file**.
2. Press **Open the upload page**. GitHub opens this repository's `guides` folder (you need a free GitHub account).
3. Drag the `.guide.json` file onto the page and press **Propose changes**, then **Create pull request**.
4. When the pull request is merged, the guide shows up in everyone's marketplace a minute later.

Updating your guide works the same way: upload a file with the same name.

## Setting up this repository (once, by the owner)

1. Create a new **public** repository on GitHub, for example `elmo-guides`.
2. Upload everything in this folder to it (including the hidden `.github` folder), on the `main` branch.
3. In the repository settings: **Actions → General → Workflow permissions → Read and write permissions**.
4. In the Elmo tool folder, open `js/market-config.js` and fill in the repository, for example
   `repo: 'your-name/elmo-guides'`. Every copy of the app you hand out then uses this marketplace.
   (Users can also type a repository in the marketplace settings.)

`tools/build_index.py` rebuilds `index.json` automatically (GitHub Actions) whenever something in `guides/` changes.
Check pull requests before merging them: a guide is plain data, but you decide what appears for everyone.
