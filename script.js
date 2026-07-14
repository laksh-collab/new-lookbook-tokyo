const imageExtensions = ["jpeg", "jpg", "png", "webp", "avif", "svg"];
const videoExtensions = ["mp4", "webm", "mov"];
const dbName = "mumma-lookbook";
const dbVersion = 3;
const storeName = "slot-media";

document.body.classList.add("js-enhanced");

const sections = Array.from(document.querySelectorAll("[data-section]"));
const navLinks = Array.from(document.querySelectorAll("[data-nav]"));
const mediaSlots = Array.from(document.querySelectorAll(".media-slot"));
const objectUrls = new Map();

let activeSlot = null;
let dbPromise = null;

const filePicker = document.createElement("input");
filePicker.type = "file";
filePicker.accept = "image/*,video/*";
filePicker.hidden = true;
document.body.append(filePicker);

const escapeHtml = (value = "") =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const mediaCandidates = (slotName, type) => {
  const primary = type === "video" ? videoExtensions : imageExtensions;
  const secondary = type === "video" ? imageExtensions : videoExtensions;
  const primaryType = type === "video" ? "video" : "image";
  const secondaryType = type === "video" ? "image" : "video";

  return [
    ...primary.flatMap((extension) => ({
      src: [`media/${slotName}.${extension}`, `${slotName}.${extension}`],
      type: primaryType,
    })),
    ...secondary.flatMap((extension) => ({
      src: [`media/${slotName}.${extension}`, `${slotName}.${extension}`],
      type: secondaryType,
    })),
  ].flatMap((candidate) =>
    candidate.src.map((src) => ({
      src,
      type: candidate.type,
    }))
  );
};

const controlsMarkup = (hasMedia) => `
  <div class="slot-controls">
    <button type="button" class="slot-control" data-action="upload">
      ${hasMedia ? "Replace" : "Add Media"}
    </button>
    ${
      hasMedia
        ? '<button type="button" class="slot-control is-secondary" data-action="clear">Clear</button>'
        : ""
    }
  </div>
`;

const placeholderMarkup = ({ label }) => `
  <div class="slot-surface">
    <div class="media-placeholder">
      <div class="placeholder-type">${escapeHtml(label)}</div>
      <div class="placeholder-body">
        <div class="placeholder-title">Add photo or video</div>
        <p class="placeholder-note">Click or drop media into this frame.</p>
      </div>
    </div>
  </div>
  ${controlsMarkup(false)}
`;

const mediaMarkup = ({ type, src, label }) => {
  if (type === "video") {
    return `
      <div class="slot-surface">
        <video muted loop playsinline preload="metadata">
          <source src="${src}" />
          Your browser does not support the video tag.
        </video>
      </div>
      ${controlsMarkup(true)}
    `;
  }

  return `
    <div class="slot-surface">
      <img src="${src}" alt="${escapeHtml(label)}" loading="lazy" />
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

const getDatabase = () => {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = window.indexedDB.open(dbName, dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "slotName" });
        }

        if (!db.objectStoreNames.contains("product-media")) {
          db.createObjectStore("product-media", { keyPath: "mediaKey" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  return dbPromise;
};

const readSavedMedia = async (slotName) => {
  const db = await getDatabase();

  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(slotName);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
};

const saveMedia = async (slotName, file) => {
  const db = await getDatabase();

  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, "readwrite");

    transaction.objectStore(storeName).put({
      slotName,
      blob: file,
      type: file.type,
      name: file.name,
      updatedAt: Date.now(),
    });

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
};

const removeSavedMedia = async (slotName) => {
  const db = await getDatabase();

  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(slotName);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
};

const revokeObjectUrl = (slotName) => {
  const currentUrl = objectUrls.get(slotName);

  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    objectUrls.delete(slotName);
  }
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
  const slotName = slot.dataset.slot;
  const preferredType = slot.dataset.type || "image";
  const sources = mediaCandidates(slotName, preferredType);

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

const renderPlaceholder = (slot) => {
  revokeObjectUrl(slot.dataset.slot);
  slot.innerHTML = placeholderMarkup({ label: slot.dataset.label || "Media" });
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
  slot.innerHTML = mediaMarkup({ ...media, label: slot.dataset.label || "Lookbook media" });
  slot.onfocusin = null;
  slot.onfocusout = null;
  slot.classList.add("has-media");
  slot.classList.remove("is-empty", "is-dragover");
  attachHoverVideoPlayback(slot);
};

const renderSlot = async (slot) => {
  const slotName = slot.dataset.slot;
  const savedMedia = await readSavedMedia(slotName);

  if (savedMedia?.blob) {
    const type = savedMedia.type?.startsWith("video/") ? "video" : "image";
    const src = URL.createObjectURL(savedMedia.blob);

    revokeObjectUrl(slotName);
    objectUrls.set(slotName, src);
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

const applyFileToSlot = async (slot, file) => {
  const mediaType = file.type.startsWith("video/") ? "video" : "image";
  const slotName = slot.dataset.slot;
  const src = URL.createObjectURL(file);

  revokeObjectUrl(slotName);
  objectUrls.set(slotName, src);
  renderMedia(slot, { type: mediaType, src });
  await saveMedia(slotName, file);
};

const openPicker = (slot) => {
  activeSlot = slot;
  filePicker.click();
};

const clearSlot = async (slot) => {
  const slotName = slot.dataset.slot;
  await removeSavedMedia(slotName);
  revokeObjectUrl(slotName);

  const fallback = await resolveFallbackMedia(slot);

  if (fallback) {
    renderMedia(slot, fallback);
    return;
  }

  renderPlaceholder(slot);
};

const handleSlotAction = async (slot, action) => {
  if (action === "clear") {
    await clearSlot(slot);
    return;
  }

  openPicker(slot);
};

const attachSlotEvents = (slot) => {
  slot.tabIndex = 0;
  slot.setAttribute("role", "button");
  slot.setAttribute("aria-label", `${slot.dataset.label}: add or replace media`);

  slot.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action) {
      event.preventDefault();
      await handleSlotAction(slot, action);
      return;
    }

    if (slot.classList.contains("is-empty")) {
      openPicker(slot);
    }
  });

  slot.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker(slot);
    }
  });

  slot.addEventListener("dragover", (event) => {
    event.preventDefault();
    slot.classList.add("is-dragover");
  });

  slot.addEventListener("dragleave", (event) => {
    if (!slot.contains(event.relatedTarget)) {
      slot.classList.remove("is-dragover");
    }
  });

  slot.addEventListener("drop", async (event) => {
    event.preventDefault();
    slot.classList.remove("is-dragover");

    const file = Array.from(event.dataTransfer?.files || []).find((candidate) => {
      return candidate.type.startsWith("image/") || candidate.type.startsWith("video/");
    });

    if (file) {
      await applyFileToSlot(slot, file);
    }
  });
};

filePicker.addEventListener("change", async () => {
  const [file] = Array.from(filePicker.files || []);

  if (!file || !activeSlot) {
    filePicker.value = "";
    activeSlot = null;
    return;
  }

  if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
    await applyFileToSlot(activeSlot, file);
  }

  filePicker.value = "";
  activeSlot = null;
});

mediaSlots.forEach((slot) => {
  attachSlotEvents(slot);
});

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        }
      });
    },
    { threshold: 0.18 }
  );

  const navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const activeSection = entry.target.dataset.section;

        navLinks.forEach((link) => {
          link.classList.toggle("is-active", link.dataset.nav === activeSection);
        });
      });
    },
    { threshold: 0.45 }
  );

  sections.forEach((section) => {
    revealObserver.observe(section);
    navObserver.observe(section);
  });
} else {
  sections.forEach((section) => {
    section.classList.add("is-visible");
  });

  if (navLinks[0]) {
    navLinks[0].classList.add("is-active");
  }
}

void Promise.all(mediaSlots.map((slot) => renderSlot(slot)));

window.addEventListener("beforeunload", () => {
  objectUrls.forEach((url) => {
    URL.revokeObjectURL(url);
  });
  objectUrls.clear();
});
