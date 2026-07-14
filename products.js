const productsStorageKey = "mumma-lookbook-products-gallery-v1";
const productsDbName = "mumma-lookbook";
const productsDbVersion = 3;
const productsMediaStore = "product-media";
const productMediaSlots = ["front"];
const productImageExtensions = ["jpeg", "jpg", "png", "webp", "avif", "svg"];
const productVideoExtensions = ["mp4", "webm", "mov"];
const productTypes = ["DRESS", "TOP", "CO-ORD SET", "SKIRT", "TUNIC", "BLOUSE"];

const defaultProductSeeds = [
  { title: "TOP", media: { front: "collection-01" } },
  { title: "DRESS", media: { front: "collection-02" } },
  { title: "BLOUSE", media: { front: "collection-03" } },
  { title: "DRESS", media: { front: "cover-hero" } },
  { title: "BLOUSE", media: { front: "product-01-back" } },
  { title: "TOP", media: { front: "product-01-front" } },
  { title: "DRESS", media: { front: "product-02-back" } },
  { title: "CO-ORD SET", media: { front: "product-02-front" } },
  { title: "DRESS", media: { front: "product-03-back" } },
  { title: "DRESS", media: { front: "product-03-front" } },
  { title: "TOP", media: { front: "product-04-back" } },
  { title: "DRESS", media: { front: "product-04-front" } },
  { title: "TUNIC", media: { front: "product-05-back" } },
  { title: "DRESS", media: { front: "product-05-front" } },
  { title: "BLOUSE", media: { front: "product-06-back" } },
  { title: "SKIRT", media: { front: "product-06-front" } },
  { title: "DRESS", media: { front: "product-07-back" } },
  { title: "DRESS", media: { front: "product-07-front" } },
  { title: "DRESS", media: { front: "product-08-back" } },
  { title: "DRESS", media: { front: "product-08-front" } },
  { title: "TUNIC", media: { front: "product-09-back" } },
  { title: "TUNIC", media: { front: "product-09-front" } },
  { title: "BLOUSE", media: { front: "product-10-back" } },
  { title: "DRESS", media: { front: "product-10-front" } },
  { title: "DRESS", media: { front: "product-11-back" } },
  { title: "TUNIC", media: { front: "product-11-front" } },
];

const productsList = document.querySelector("#productsList");
const addProductButton = document.querySelector("#addProductButton");
const addProductButtonBottom = document.querySelector("#addProductButtonBottom");
const objectUrls = new Map();

let products = [];
let activeSlot = null;
let dbPromise = null;
let revealObserver = null;

document.body.classList.add("products-enhanced");

const filePicker = document.createElement("input");
filePicker.type = "file";
filePicker.hidden = true;
document.body.append(filePicker);

const createId = () => {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `product-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeProductType = (value = "DRESS") => {
  const normalized = String(value).trim().toUpperCase();

  const aliases = {
    DRESSES: "DRESS",
    "SHORT DRESS": "DRESS",
    "MAXI DRESS": "DRESS",
    TOPS: "TOP",
    SHIRT: "TOP",
    SHIRTS: "TOP",
    "TOPS / SHIRTS": "TOP",
    "COORD SET": "CO-ORD SET",
    "CO ORD SET": "CO-ORD SET",
    "CO-ORD": "CO-ORD SET",
    "COORD": "CO-ORD SET",
    "CO-ORDS": "CO-ORD SET",
    SKIRTS: "SKIRT",
    PALAZZO: "SKIRT",
    PANTS: "SKIRT",
    BOTTOM: "SKIRT",
    BOTTOMS: "SKIRT",
    "SKIRTS / PALAZZO": "SKIRT",
    "PALAZZO / PANTS": "SKIRT",
    TUNICS: "TUNIC",
    BLOUSES: "BLOUSE",
  };

  const resolved = aliases[normalized] || normalized;
  return productTypes.includes(resolved) ? resolved : "DRESS";
};

const normalizeMedia = (media = null) => ({
  front: media?.front || "",
});

const normalizeMediaHidden = (mediaHidden = null) => ({
  front: Boolean(mediaHidden?.front),
});

const createProduct = (seed = {}) => ({
  id: createId(),
  title: normalizeProductType(seed.title),
  mediaBase: seed.mediaBase || "",
  media: normalizeMedia(seed.media),
  mediaHidden: normalizeMediaHidden(seed.mediaHidden),
  allowFallback: seed.allowFallback ?? Boolean(seed.media?.front || seed.mediaBase),
});

const normalizeProduct = (seed = {}) => ({
  id: seed.id || createId(),
  title: normalizeProductType(seed.title),
  mediaBase: seed.mediaBase || "",
  media: normalizeMedia(seed.media),
  mediaHidden: normalizeMediaHidden(seed.mediaHidden),
  allowFallback: seed.allowFallback ?? Boolean(seed.media?.front || seed.mediaBase),
});

const createDefaultProducts = () => defaultProductSeeds.map((seed) => createProduct(seed));

const loadProducts = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(productsStorageKey) || "[]");

    if (!Array.isArray(stored) || stored.length === 0) {
      return createDefaultProducts();
    }

    return stored
      .map((item) => normalizeProduct(item))
      .filter((product) => !product.mediaHidden.front);
  } catch {
    return createDefaultProducts();
  }
};

const saveProducts = () => {
  window.localStorage.setItem(productsStorageKey, JSON.stringify(products));
};

const getProduct = (productId) => products.find((product) => product.id === productId);

const slotKey = (productId, slotName) => `${productId}-${slotName}`;

const productFallbackName = (product, index, slotName) => {
  if (product.mediaHidden?.[slotName]) {
    return "";
  }

  if (product.media?.[slotName]) {
    return product.media[slotName];
  }

  if (product.mediaBase) {
    return product.mediaBase;
  }

  if (!product.allowFallback) {
    return "";
  }

  return `product-${String(index + 1).padStart(2, "0")}-${slotName}`;
};

const getDatabase = () => {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = window.indexedDB.open(productsDbName, productsDbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("slot-media")) {
          db.createObjectStore("slot-media", { keyPath: "slotName" });
        }

        if (!db.objectStoreNames.contains(productsMediaStore)) {
          db.createObjectStore(productsMediaStore, { keyPath: "mediaKey" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  return dbPromise;
};

const readMedia = async (mediaKey) => {
  const db = await getDatabase();

  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    const request = db
      .transaction(productsMediaStore, "readonly")
      .objectStore(productsMediaStore)
      .get(mediaKey);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
};

const saveMedia = async (mediaKey, file) => {
  const db = await getDatabase();

  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(productsMediaStore, "readwrite");

    transaction.objectStore(productsMediaStore).put({
      mediaKey,
      blob: file,
      type: file.type,
      name: file.name,
      updatedAt: Date.now(),
    });

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
};

const removeMedia = async (mediaKey) => {
  const db = await getDatabase();

  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(productsMediaStore, "readwrite");
    transaction.objectStore(productsMediaStore).delete(mediaKey);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
};

const cloneProductMedia = async (sourceId, targetId) => {
  for (const slotName of productMediaSlots) {
    const currentMedia = await readMedia(slotKey(sourceId, slotName));

    if (currentMedia?.blob) {
      const clonedBlob = currentMedia.blob.slice(
        0,
        currentMedia.blob.size,
        currentMedia.blob.type
      );

      await saveMedia(slotKey(targetId, slotName), clonedBlob);
    }
  }
};

const removeProductMedia = async (productId) => {
  for (const slotName of productMediaSlots) {
    await removeMedia(slotKey(productId, slotName));
    revokeObjectUrl(slotKey(productId, slotName));
  }
};

const revokeObjectUrl = (mediaKey) => {
  const currentUrl = objectUrls.get(mediaKey);

  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    objectUrls.delete(mediaKey);
  }
};

const revokeAllObjectUrls = () => {
  objectUrls.forEach((url) => {
    URL.revokeObjectURL(url);
  });

  objectUrls.clear();
};

const mediaCandidates = (baseName, preferredType = "image") => {
  const primary = preferredType === "video" ? productVideoExtensions : productImageExtensions;
  const secondary = preferredType === "video" ? productImageExtensions : productVideoExtensions;
  const primaryType = preferredType === "video" ? "video" : "image";
  const secondaryType = preferredType === "video" ? "image" : "video";

  return [
    ...primary.flatMap((extension) => ({
      src: [`media/${baseName}.${extension}`, `${baseName}.${extension}`],
      type: primaryType,
    })),
    ...secondary.flatMap((extension) => ({
      src: [`media/${baseName}.${extension}`, `${baseName}.${extension}`],
      type: secondaryType,
    })),
  ].flatMap((candidate) =>
    candidate.src.map((src) => ({
      src,
      type: candidate.type,
    }))
  );
};

const tryLoadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const tryLoadVideo = (src) =>
  new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };

    video.onloadeddata = () => {
      cleanup();
      resolve(src);
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = src;
  });

const resolveFallbackMedia = async (slot) => {
  const fallbackName = slot.dataset.fallbackName;

  if (!fallbackName) {
    return null;
  }

  const sources = mediaCandidates(fallbackName, slot.dataset.preferredType || "image");

  for (const candidate of sources) {
    const src =
      candidate.type === "video"
        ? await tryLoadVideo(candidate.src)
        : await tryLoadImage(candidate.src);

    if (src) {
      return { src, type: candidate.type };
    }
  }

  return null;
};

const controlsMarkup = (hasMedia) => `
  <div class="slot-controls">
    <button type="button" class="slot-button" data-slot-action="upload">
      ${hasMedia ? "Replace" : "Add Image"}
    </button>
    ${
      hasMedia
        ? '<button type="button" class="slot-button" data-slot-action="clear">Delete</button>'
        : ""
    }
  </div>
`;

const placeholderMarkup = () => `
  <div class="slot-surface">
    <div class="product-placeholder">Add image</div>
  </div>
  ${controlsMarkup(false)}
`;

const mediaMarkup = ({ type, src, label }) => {
  const safeSrc = escapeHtml(src);
  const element =
    type === "video"
      ? `
        <video muted loop playsinline preload="metadata">
          <source src="${safeSrc}" />
          Your browser does not support the video tag.
        </video>
      `
      : `<img src="${safeSrc}" alt="${escapeHtml(label)}" loading="lazy" />`;

  return `
    <div class="slot-surface">
      ${element}
    </div>
    ${controlsMarkup(true)}
  `;
};

const waitForImageElement = (img) =>
  new Promise((resolve) => {
    if (!img || img.complete) {
      resolve();
      return;
    }

    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  });

const waitForVideoElement = (video) =>
  new Promise((resolve) => {
    if (!video || video.readyState >= 2) {
      resolve();
      return;
    }

    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => resolve(), { once: true });
  });

const productTypeOptions = (selectedType) =>
  productTypes
    .map(
      (type) =>
        `<option value="${type}" ${type === selectedType ? "selected" : ""}>${type}</option>`
    )
    .join("");

const productSlotMarkup = ({ productId, fallbackName, label }) => `
  <div
    class="product-upload-slot is-empty"
    data-media-key="${slotKey(productId, "front")}"
    data-slot-name="front"
    data-fallback-name="${escapeHtml(fallbackName)}"
    data-preferred-type="image"
    data-label="${escapeHtml(label)}"
    data-accept="image/*,video/*"
    tabindex="0"
    role="button"
    aria-label="${escapeHtml(label)}: add or replace media"
  ></div>
`;

const productMarkup = (product, index) => {
  const title = normalizeProductType(product.title);
  const revealDelay = `${(index % 9) * 34}ms`;

  return `
    <article class="product-card reveal" data-product-id="${product.id}" style="--reveal-delay: ${revealDelay}">
      <div class="product-card-toolbar" aria-label="Product controls">
        <button type="button" class="card-tool" data-product-action="move-up" aria-label="Move product up">Up</button>
        <button type="button" class="card-tool" data-product-action="move-down" aria-label="Move product down">Down</button>
        <button type="button" class="card-tool" data-product-action="duplicate" aria-label="Duplicate product">Copy</button>
        <button type="button" class="card-tool is-danger" data-product-action="remove" aria-label="Remove product">Remove</button>
      </div>

      ${productSlotMarkup({
        productId: product.id,
        fallbackName: productFallbackName(product, index, "front"),
        label: `${title} product image`,
      })}

      <label class="product-type-label">
        <span class="sr-only">Product type</span>
        <select class="product-type-select" data-field="title" aria-label="Product type">
          ${productTypeOptions(title)}
        </select>
      </label>
    </article>
  `;
};

const renderPlaceholder = (slot) => {
  revokeObjectUrl(slot.dataset.mediaKey);
  slot.innerHTML = placeholderMarkup();
  slot.onfocusin = null;
  slot.onfocusout = null;
  slot.classList.add("is-empty");
  slot.classList.remove("has-media", "is-dragover");
};

const attachHoverVideoPlayback = (slot) => {
  const video = slot.querySelector("video");

  if (!video) {
    return;
  }

  const playVideo = () => {
    video.play().catch(() => {});
  };

  const pauseVideo = () => {
    video.pause();
  };

  video.onmouseenter = playVideo;
  video.onmouseleave = pauseVideo;
  slot.onfocusin = playVideo;
  slot.onfocusout = pauseVideo;
};

const renderMedia = (slot, media) => {
  slot.innerHTML = mediaMarkup({ ...media, label: slot.dataset.label || "Product image" });
  slot.onfocusin = null;
  slot.onfocusout = null;
  slot.classList.add("has-media");
  slot.classList.remove("is-empty", "is-dragover");
  attachHoverVideoPlayback(slot);
};

const renderSlot = async (slot) => {
  const mediaKey = slot.dataset.mediaKey;
  const currentMedia = await readMedia(mediaKey);

  if (currentMedia?.blob) {
    const type = currentMedia.type?.startsWith("video/") ? "video" : "image";
    const src = URL.createObjectURL(currentMedia.blob);

    revokeObjectUrl(mediaKey);
    objectUrls.set(mediaKey, src);
    renderMedia(slot, { type, src });

    if (type === "video") {
      await waitForVideoElement(slot.querySelector("video"));
      return;
    }

    await waitForImageElement(slot.querySelector("img"));
    return;
  }

  const fallback = await resolveFallbackMedia(slot);

  if (fallback) {
    renderMedia(slot, fallback);

    if (fallback.type === "video") {
      await waitForVideoElement(slot.querySelector("video"));
      return;
    }

    await waitForImageElement(slot.querySelector("img"));
    return;
  }

  renderPlaceholder(slot);
};

const observeReveals = () => {
  document.body.classList.add("products-enhanced");

  if (revealObserver) {
    revealObserver.disconnect();
  }

  const revealItems = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
};

const renderProducts = async () => {
  revokeAllObjectUrls();
  productsList.innerHTML = products.map((product, index) => productMarkup(product, index)).join("");

  await Promise.all(
    Array.from(document.querySelectorAll(".product-upload-slot")).map((slot) => renderSlot(slot))
  );

  observeReveals();
};

const applyFileToSlot = async (slot, file) => {
  const mediaKey = slot.dataset.mediaKey;
  const mediaType = file.type.startsWith("video/") ? "video" : "image";
  const src = URL.createObjectURL(file);
  const productElement = slot.closest("[data-product-id]");
  const currentProduct = productElement ? getProduct(productElement.dataset.productId) : null;
  const slotName = slot.dataset.slotName || "front";

  if (currentProduct) {
    currentProduct.mediaHidden = normalizeMediaHidden(currentProduct.mediaHidden);
    currentProduct.mediaHidden[slotName] = false;
    saveProducts();
  }

  revokeObjectUrl(mediaKey);
  objectUrls.set(mediaKey, src);
  renderMedia(slot, { type: mediaType, src });
  await saveMedia(mediaKey, file);
};

const openPicker = (slot) => {
  activeSlot = slot;
  filePicker.accept = slot.dataset.accept || "image/*,video/*";
  filePicker.click();
};

const clearSlot = async (slot) => {
  const productElement = slot.closest("[data-product-id]");

  if (productElement?.dataset.productId) {
    await removeProduct(productElement.dataset.productId);
    return;
  }

  await removeMedia(slot.dataset.mediaKey);
  renderPlaceholder(slot);
};

const addProduct = async () => {
  const newProduct = createProduct({ title: "DRESS" });
  products.push(newProduct);
  saveProducts();
  await renderProducts();

  requestAnimationFrame(() => {
    const nextProduct = document.querySelector(`[data-product-id="${newProduct.id}"]`);
    nextProduct?.scrollIntoView({ behavior: "smooth", block: "center" });
    nextProduct?.querySelector(".product-upload-slot")?.focus();
  });
};

const duplicateProduct = async (productId) => {
  const currentIndex = products.findIndex((product) => product.id === productId);

  if (currentIndex === -1) {
    return;
  }

  const duplicate = createProduct(products[currentIndex]);
  products.splice(currentIndex + 1, 0, duplicate);
  await cloneProductMedia(productId, duplicate.id);
  saveProducts();
  await renderProducts();
};

const moveProduct = async (productId, direction) => {
  const currentIndex = products.findIndex((product) => product.id === productId);
  const targetIndex = currentIndex + direction;

  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= products.length) {
    return;
  }

  const [currentProduct] = products.splice(currentIndex, 1);
  products.splice(targetIndex, 0, currentProduct);
  saveProducts();
  await renderProducts();
};

const removeProduct = async (productId) => {
  const currentIndex = products.findIndex((product) => product.id === productId);

  if (currentIndex === -1) {
    return;
  }

  await removeProductMedia(productId);
  products.splice(currentIndex, 1);

  saveProducts();
  await renderProducts();
};

const handleProductAction = async (button) => {
  const product = button.closest("[data-product-id]");

  if (!product) {
    return;
  }

  const productId = product.dataset.productId;
  const action = button.dataset.productAction;

  if (action === "duplicate") {
    await duplicateProduct(productId);
    return;
  }

  if (action === "remove") {
    await removeProduct(productId);
    return;
  }

  if (action === "move-up") {
    await moveProduct(productId, -1);
    return;
  }

  if (action === "move-down") {
    await moveProduct(productId, 1);
  }
};

productsList.addEventListener("click", async (event) => {
  const productAction = event.target.closest("[data-product-action]");

  if (productAction) {
    await handleProductAction(productAction);
    return;
  }

  const slotAction = event.target.closest("[data-slot-action]");
  const slot = event.target.closest(".product-upload-slot");

  if (slotAction && slot) {
    event.preventDefault();

    if (slotAction.dataset.slotAction === "clear") {
      await clearSlot(slot);
      return;
    }

    openPicker(slot);
    return;
  }

  const emptySlot = event.target.closest(".product-upload-slot.is-empty");

  if (emptySlot) {
    openPicker(emptySlot);
  }
});

productsList.addEventListener("keydown", (event) => {
  const slot = event.target.closest(".product-upload-slot");

  if (!slot) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openPicker(slot);
  }
});

productsList.addEventListener("dragover", (event) => {
  const slot = event.target.closest(".product-upload-slot");

  if (!slot) {
    return;
  }

  event.preventDefault();
  slot.classList.add("is-dragover");
});

productsList.addEventListener("dragleave", (event) => {
  const slot = event.target.closest(".product-upload-slot");

  if (!slot) {
    return;
  }

  if (!slot.contains(event.relatedTarget)) {
    slot.classList.remove("is-dragover");
  }
});

productsList.addEventListener("drop", async (event) => {
  const slot = event.target.closest(".product-upload-slot");

  if (!slot) {
    return;
  }

  event.preventDefault();
  slot.classList.remove("is-dragover");

  const acceptsVideo = slot.dataset.accept.includes("video");
  const file = Array.from(event.dataTransfer?.files || []).find((candidate) => {
    if (candidate.type.startsWith("image/")) {
      return true;
    }

    return acceptsVideo && candidate.type.startsWith("video/");
  });

  if (file) {
    await applyFileToSlot(slot, file);
  }
});

productsList.addEventListener("change", (event) => {
  const field = event.target.dataset.field;

  if (!field) {
    return;
  }

  const product = event.target.closest("[data-product-id]");
  const currentProduct = product ? getProduct(product.dataset.productId) : null;

  if (!currentProduct) {
    return;
  }

  currentProduct[field] = normalizeProductType(event.target.value);
  event.target.value = currentProduct[field];
  saveProducts();
});

filePicker.addEventListener("change", async () => {
  const [file] = Array.from(filePicker.files || []);

  if (!file || !activeSlot) {
    filePicker.value = "";
    activeSlot = null;
    return;
  }

  const acceptsVideo = activeSlot.dataset.accept.includes("video");
  const isValidImage = file.type.startsWith("image/");
  const isValidVideo = acceptsVideo && file.type.startsWith("video/");

  if (isValidImage || isValidVideo) {
    await applyFileToSlot(activeSlot, file);
  }

  filePicker.value = "";
  activeSlot = null;
});

addProductButton?.addEventListener("click", () => {
  void addProduct();
});

addProductButtonBottom?.addEventListener("click", () => {
  void addProduct();
});

products = loadProducts();
saveProducts();
void renderProducts();

window.addEventListener("beforeunload", () => {
  revokeAllObjectUrls();
});
