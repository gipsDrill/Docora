# Docora.uk domain setup

This package is already configured for `https://docora.uk`.

## GitHub Pages

1. Upload all files from this package to the root of the Docora repository.
2. Open **Settings → Pages**.
3. Publish from the `main` branch and `/(root)` folder.
4. Under **Custom domain**, enter `docora.uk` and save.
5. Keep the included `CNAME` file in the repository root.
6. Enable **Enforce HTTPS** when GitHub makes the option available.

## DNS records

For an apex domain on GitHub Pages, create these DNS records:

- `A` — name `@` — `185.199.108.153`
- `A` — name `@` — `185.199.109.153`
- `A` — name `@` — `185.199.110.153`
- `A` — name `@` — `185.199.111.153`
- `CNAME` — name `www` — your GitHub Pages host, normally `gipsdrill.github.io`

Use DNS-only mode while GitHub issues the HTTPS certificate. Configure `www.docora.uk` to redirect to `https://docora.uk` if your DNS/hosting provider does not do this automatically.

## After launch

- Open `https://docora.uk/robots.txt`.
- Open `https://docora.uk/sitemap.xml`.
- Add `docora.uk` to Google Search Console.
- Submit `https://docora.uk/sitemap.xml`.
- Test the social preview image at `https://docora.uk/assets/og-image.png`.
