(() => {
  "use strict";
  class CatalogInfiniteFeed {
    constructor({ container, loader, requestPage, itemsHTML, onProgress }) {
      Object.assign(this, {
        container,
        loader,
        requestPage,
        itemsHTML,
        onProgress,
      });
      this.batches = new Map();
      this.revision = 0;
      this.loading = false;
      this.failed = false;
      this.lastPage = 0;
      this.tick = null;
      this.pending = new Map();
      if ("IntersectionObserver" in window) {
        this.nextObserver = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) this.loadMore();
          },
          { rootMargin: "700px 0px" },
        );
        this.batchObserver = new IntersectionObserver(
          (entries) => {
            for (const e of entries)
              if (e.isIntersecting)
                this.restoreBatch(Number(e.target.dataset.batch));
          },
          { rootMargin: "1000px 0px" },
        );
      }
      if ("ResizeObserver" in window)
        this.resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const batch = this.batches.get(Number(entry.target.dataset.batch));
            if (batch?.live) {
              const height = entry.target.getBoundingClientRect().height;
              if (height > 0) batch.height = height;
            }
          }
        });
      this.scrollHandler = () => {
        if (this.tick !== null) return;
        this.tick = requestAnimationFrame(() => {
          this.tick = null;
          this.trim();
          if (!this.batchObserver)
            for (const batch of this.batches.values()) {
              const rect = batch.element.getBoundingClientRect();
              if (rect.bottom > -700 && rect.top < innerHeight + 700)
                this.restoreBatch(batch.page);
            }
          if (
            !this.nextObserver &&
            !this.failed &&
            !this.loading &&
            this.lastPage < this.meta?.pages
          ) {
            const rect = this.loader.getBoundingClientRect();
            if (rect.top < innerHeight + 700 && rect.bottom > 0)
              this.loadMore();
          }
        });
      };
      window.addEventListener("scroll", this.scrollHandler, { passive: true });
      window.addEventListener("resize", this.scrollHandler, { passive: true });
      loader.addEventListener("click", (event) => {
        if (event.target.closest("[data-load-more]")) this.loadMore(true);
      });
      container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-restore-batch]");
        if (button)
          this.restoreBatch(Number(button.dataset.restoreBatch), true);
      });
    }
    clear() {
      this.revision++;
      this.nextObserver?.disconnect();
      this.batchObserver?.disconnect();
      this.resizeObserver?.disconnect();
      this.batches.clear();
      this.pending.clear();
      this.lastPage = 0;
      this.loading = false;
      this.failed = false;
      this.meta = null;
      this.loader.replaceChildren();
    }
    estimate(count) {
      const columns = innerWidth >= 1500 ? 4 : innerWidth > 1050 ? 3 : 2;
      return Math.ceil(count / columns) * (innerWidth <= 480 ? 390 : 490);
    }
    makeBatch(page, items = null, height = 0) {
      const element = document.createElement("div");
      element.className = "catalog-batch";
      element.dataset.batch = page;
      element.setAttribute("role", "group");
      element.setAttribute(
        "aria-label",
        `Produtos ${(page - 1) * this.meta.limit + 1} a ${Math.min(page * this.meta.limit, this.meta.total)}`,
      );
      const batch = {
        page,
        items,
        element,
        height:
          height ||
          this.estimate(
            Math.min(
              this.meta.limit,
              this.meta.total - (page - 1) * this.meta.limit,
            ),
          ),
        live: false,
        used: Date.now(),
      };
      this.batches.set(page, batch);
      this.container.append(element);
      this.placeholder(batch);
      this.batchObserver?.observe(element);
      return batch;
    }
    placeholder(batch) {
      batch.live = false;
      this.resizeObserver?.unobserve(batch.element);
      batch.element.style.height = batch.height + "px";
      batch.element.innerHTML = `<button class="catalog-restore" type="button" data-restore-batch="${batch.page}">Reabrir produtos deste trecho</button>`;
    }
    materialize(batch) {
      if (batch.live || !batch.items) return;
      batch.used = Date.now();
      batch.live = true;
      batch.element.style.height = "";
      batch.element.style.setProperty("--batch-height", batch.height + "px");
      batch.element.innerHTML =
        '<div class="catalog-batch-grid">' +
        this.itemsHTML(batch.items) +
        "</div>";
      batch.element
        .querySelectorAll("img")
        .forEach((img) =>
          img.addEventListener(
            "error",
            () => (img.src = "/public/image/placeholder.svg"),
            { once: true },
          ),
        );
      this.resizeObserver?.observe(batch.element);
      const actual = batch.element.getBoundingClientRect().height;
      if (actual > 0) batch.height = actual;
    }
    async reset(meta, items, saved) {
      this.clear();
      const revision = this.revision;
      this.meta = meta;
      this.container.replaceChildren();
      const count = Math.max(1, Math.min(saved?.lastPage || 1, meta.pages));
      for (let page = 1; page <= count; page++) {
        const batch = this.makeBatch(
          page,
          page === 1 ? items : null,
          saved?.heights?.[page],
        );
        if (page === 1) this.materialize(batch);
      }
      this.lastPage = count;
      if (saved?.anchor > 1 && saved.anchor <= count)
        await this.restoreBatch(saved.anchor);
      if (revision !== this.revision) return;
      this.status();
      this.trim();
    }
    async fetchBatch(page) {
      if (this.pending.has(page)) return this.pending.get(page);
      const task = this.requestPage(page);
      this.pending.set(page, task);
      try {
        return await task;
      } finally {
        if (this.pending.get(page) === task) this.pending.delete(page);
      }
    }
    async restoreBatch(page, focus = false) {
      const batch = this.batches.get(page);
      if (!batch || batch.live) return;
      const revision = this.revision;
      try {
        if (!batch.items) {
          const result = await this.fetchBatch(page);
          if (revision !== this.revision) return;
          batch.items = result.products;
        }
        if (revision !== this.revision) return;
        this.materialize(batch);
        if (focus) batch.element.querySelector("a,button")?.focus();
        this.trim();
      } catch (error) {
        if (revision !== this.revision) return;
        batch.element
          .querySelector("button")
          ?.replaceChildren(
            document.createTextNode(
              "Não foi possível carregar este trecho. Toque para tentar novamente.",
            ),
          );
      }
    }
    async loadMore(manual = false) {
      if (
        !this.meta ||
        this.loading ||
        this.lastPage >= this.meta.pages ||
        (!manual && this.failed)
      )
        return;
      const focusNew = manual && this.loader.contains(document.activeElement);
      this.loading = true;
      this.failed = false;
      const revision = this.revision,
        page = this.lastPage + 1;
      this.status();
      try {
        const result = await this.fetchBatch(page);
        if (revision !== this.revision) return;
        if (result.page !== page)
          throw Error(
            "O catálogo mudou. Atualize os resultados para continuar.",
          );
        const existing = new Set(
          [...this.batches.values()].flatMap((b) =>
            (b.items || []).map((p) => p._id),
          ),
        );
        const batch = this.makeBatch(
          page,
          result.products.filter((p) => !existing.has(p._id)),
        );
        this.materialize(batch);
        this.lastPage = page;
        if (focusNew) batch.element.querySelector("a,button")?.focus();
      } catch (error) {
        if (revision !== this.revision) return;
        this.failed = true;
      } finally {
        if (revision === this.revision) {
          this.loading = false;
          this.status();
          this.trim();
        }
      }
    }
    status() {
      if (!this.meta) return;
      this.nextObserver?.disconnect();
      const loaded = Math.min(this.lastPage * this.meta.limit, this.meta.total);
      this.onProgress?.(loaded, this.meta.total);
      if (this.failed)
        this.loader.innerHTML =
          '<p role="status">Não foi possível carregar mais produtos. Os itens anteriores continuam aqui.</p><button type="button" data-load-more>Tentar novamente →</button>';
      else if (this.loading)
        this.loader.innerHTML =
          '<p role="status"><span class="catalog-spinner" aria-hidden="true"></span> Carregando mais produtos…</p>';
      else if (this.lastPage >= this.meta.pages)
        this.loader.innerHTML = this.meta.total
          ? '<p role="status">Você chegou ao fim dos resultados. ♡</p>'
          : "";
      else {
        this.loader.innerHTML =
          '<p>Continue rolando para explorar os produtos.</p><button type="button" class="' +
          (this.nextObserver ? "catalog-more-keyboard" : "") +
          '" data-load-more>Carregar mais produtos ↓</button>';
        this.nextObserver?.observe(this.loader);
      }
    }
    trim() {
      const live = [...this.batches.values()].filter((b) => b.live);
      if (live.length > 5) {
        for (const batch of live) {
          if ([...this.batches.values()].filter((b) => b.live).length <= 5)
            break;
          if (batch.element.contains(document.activeElement)) continue;
          const rect = batch.element.getBoundingClientRect();
          if (rect.bottom > -1000 && rect.top < innerHeight + 1000) continue;
          const height = rect.height;
          if (height > 0) batch.height = height;
          this.placeholder(batch);
        }
      }
      const cached = [...this.batches.values()]
        .filter((b) => b.items)
        .sort((a, b) => a.used - b.used);
      let excess = cached.length - 8;
      for (const batch of cached) {
        if (excess <= 0) break;
        if (!batch.live) {
          batch.items = null;
          excess--;
        }
      }
    }
    save() {
      let anchor = 1;
      const heights = {};
      for (const batch of this.batches.values()) {
        const rect = batch.element.getBoundingClientRect();
        heights[batch.page] = rect.height || batch.height;
        if (rect.top <= innerHeight * 0.5 && rect.bottom > 0)
          anchor = batch.page;
      }
      return { lastPage: this.lastPage, anchor, heights };
    }
  }
  window.CatalogInfiniteFeed = CatalogInfiniteFeed;
})();
