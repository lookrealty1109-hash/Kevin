const perPage = 50;

let page = 1;
let allData = [];
let filteredData = [];
let currentVersion = "";
let currentSort = "default";
let activeSearchPrice = 0;
let propertyViewState = null;

const id = new URLSearchParams(window.location.search).get("id");

// Derive THIS site's own base URL from the current page location so every user's
// page loads its own data (version.json / listings-page-N.json) instead of a
// hardcoded repo. Works for GitHub Pages project sites: https://{owner}.github.io/{repo}/
const siteBase = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "");

function parsePriceNumber(p){
  if(p === null || p === undefined) return 0;
  let text = p.toString().toLowerCase().trim();
  text = text.replace(/rm/g, "").replace(/\s+/g, "").replace(/,/g, "");
  if(!text) return 0;
  let num = 0;
  if(text.endsWith("m")){
    num = parseFloat(text.slice(0, -1)) * 1000000;
  }else if(text.endsWith("k")){
    num = parseFloat(text.slice(0, -1)) * 1000;
  }else{
    num = parseFloat(text);
  }
  return isNaN(num) ? 0 : Math.round(num);
}

function formatPrice(p){
  let num = parsePriceNumber(p);
  if(!num) return "";
  return "RM " + Math.round(num).toLocaleString('en-MY');
}

function formatRooms(r,b,p){
  let parts = [];
  if(r && r !== '0') parts.push(r + " Room" + (parseInt(r) === 1 ? '' : 's'));
  if(b && b !== '0') parts.push(b + " Bath" + (parseInt(b) === 1 ? '' : 's'));
  if(p && p !== '0') parts.push(p + " Parking");
  return parts.join(' · ');
}

const META_ICONS = {
  bed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v11m0-4h18m0 4v-8a2 2 0 0 0-2-2h-8v6"/><circle cx="7" cy="10" r="1"/></svg>`,
  bath: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16a1 1 0 0 1 1 1v2a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-2a1 1 0 0 1 1-1z"/><path d="M6 12V6a2 2 0 0 1 4 0"/><path d="M8 19l-1 2m10-2 1 2"/></svg>`,
  car: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17H3v-6l2-5h9l4 5h2a1 1 0 0 1 1 1v5h-2m-4 0H9"/></svg>`
};

// Bottom-aligned meta row: bed / bath / parking icons + size on the right.
// Empty fields are skipped entirely so no blank rows or orphan "sqft" appear.
function buildMetaRowHtml(item){
  const parts = [];
  if(item.rooms && item.rooms !== '0') parts.push(`<span class="meta-item">${META_ICONS.bed}${item.rooms}</span>`);
  if(item.baths && item.baths !== '0') parts.push(`<span class="meta-item">${META_ICONS.bath}${item.baths}</span>`);
  if(item.parking && item.parking !== '0') parts.push(`<span class="meta-item">${META_ICONS.car}${item.parking}</span>`);
  const size = (item.size && item.size !== '0') ? `<span class="meta-size">${item.size} sqft</span>` : '';
  if(!parts.length && !size) return '';
  return `<div class="meta-row">${parts.join('')}${size}</div>`;
}

function parseListingType(typeStr) {
  if (!typeStr) return { propType: '', rawAddress: '' };
  const atIdx = typeStr.indexOf(' @ ');
  // No address combined — whole string is the property type (badge only, no address)
  if (atIdx === -1) return { propType: typeStr.trim(), rawAddress: '' };
  return { propType: typeStr.slice(0, atIdx).trim(), rawAddress: typeStr.slice(atIdx + 3).trim() };
}

function sanitizeAddress(rawAddress) {
  if (!rawAddress) return '';
  if (!/jalan/i.test(rawAddress)) return rawAddress;
  const commaIdx = rawAddress.lastIndexOf(', ');
  if (commaIdx === -1) return '';
  const before = rawAddress.slice(0, commaIdx).trim();
  const after  = rawAddress.slice(commaIdx + 2).trim();
  if (/jalan/i.test(after)) return before;
  return after;
}

// Two-line address HTML matching CRM non-owner view:
// Line 1 (bold): building name for Highrise, empty for Terrace
// Line 2 (muted): Community + Taman + City
// Falls back to legacy sanitizeAddress for old data without addrMain/addrArea.
function buildAddressHtml(item) {
  if (item.addrMain !== undefined || item.addrArea !== undefined) {
    let html = '';
    if (item.addrMain) html += `<div class="addr-main">${item.addrMain}</div>`;
    if (item.addrArea) html += `<div class="addr-area">${item.addrArea}</div>`;
    return html;
  }
  const { rawAddress } = parseListingType(item.type);
  const display = sanitizeAddress(rawAddress);
  return display ? `<div class="address">${display}</div>` : '';
}

// Convert any photo URL to an lh3 CDN URL for CORS-safe fetch download.
// lh3 supports CORS; drive.google.com/thumbnail does not.
function toDownloadUrl(url) {
  if (!url) return '';
  if (url.includes('lh3.googleusercontent.com')) {
    return url.split('=')[0] + '=w1200';
  }
  if (url.includes('firebasestorage.app') || url.includes('firebasestorage.googleapis.com')) {
    return url;
  }
  const match = url.match(/\/d\/([-\w]{25,})|id=([-\w]{25,})/);
  if (match) {
    const fileId = match[1] || match[2];
    return `https://lh3.googleusercontent.com/d/${fileId}=w1200`;
  }
  return url.replace('http://', 'https://');
}

function withVersion(url){
  if(!url) return "";
  let secureUrl = url.replace("http://", "https://");
  if(!currentVersion) return secureUrl;
  return secureUrl + (secureUrl.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(currentVersion);
}

function withImageSize(url, size){
  if(!url) return "";

  // 拦截空照片
  if(url.includes("profile/picture/0") || url.includes("profile/picture/2")){
     return "https://placehold.co/600x400/eeeeee/999999?text=No+Photo";
  }

  // lh3.googleusercontent.com CDN — append size suffix directly (fastest path)
  if(url.includes("lh3.googleusercontent.com")){
    const base = url.split("=")[0]; // strip any existing size param
    return base + "=" + size;
  }

  // Firebase Storage — use directly, no Drive thumbnail needed
  if(url.includes("firebasestorage.app") || url.includes("firebasestorage.googleapis.com")){
    return url;
  }

  // Fallback: extract Drive file ID and use thumbnail API
  // Must be exactly a Drive file ID (26-33 chars of [-\w]), not a domain/path
  let match = url.match(/\/d\/([-\w]{25,})|id=([-\w]{25,})/);
  if(match){
    const fileId = match[1] || match[2];
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=${size}`;
  }

  return withVersion(url);
}

function preloadImage(url){
  if(!url) return;
  let img = new Image();
  img.src = url;
}

// 将下载链接转换为预览链接以解决视频黑屏
function getDrivePreviewUrl(url) {
  if (!url) return "";
  // drive.google.com/uc?export=download&id=FILEID
  let match = url.match(/id=([-\w]{25,})/);
  if (match && match[1]) {
    return `https://drive.google.com/file/d/${match[1]}/preview`;
  }
  // lh3.googleusercontent.com/d/FILEID
  let lhMatch = url.match(/lh3\.googleusercontent\.com\/d\/([-\w]{25,})/);
  if (lhMatch && lhMatch[1]) {
    return `https://drive.google.com/file/d/${lhMatch[1]}/preview`;
  }
  return url.replace("http://", "https://");
}

function getSearchInputValue(){
  const search = document.getElementById("searchInput");
  return search ? search.value : "";
}

function normalizeSearchPriceInput(q){
  return parsePriceNumber(q);
}

function cloneData(arr){
  return Array.isArray(arr) ? [...arr] : [];
}


function sortListings(data){
  let result = cloneData(data);
  if(activeSearchPrice > 0){
    result.sort((a, b) => {
      let aPrice = parsePriceNumber(a.price || "");
      let bPrice = parsePriceNumber(b.price || "");
      let aDiff = Math.abs(aPrice - activeSearchPrice);
      let bDiff = Math.abs(bPrice - activeSearchPrice);
      if(aDiff !== bDiff) return aDiff - bDiff;
      return bPrice - aPrice;
    });
    return result;
  }
  if(currentSort === "price-low-high"){
    result.sort((a, b) => parsePriceNumber(a.price || "") - parsePriceNumber(b.price || ""));
  }else if(currentSort === "price-high-low"){
    result.sort((a, b) => parsePriceNumber(b.price || "") - parsePriceNumber(a.price || ""));
  }else if(currentSort === "size-low-high"){
    result.sort((a, b) => Number(a.size || 0) - Number(b.size || 0));
  }else if(currentSort === "size-high-low"){
    result.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  }
  return result;
}

function updateResults(){
  filteredData = sortListings(allData);
  page = 1;
  showListings();
}

async function fetchJsonNoCache(url){
  let res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error("Failed to fetch " + url);
  return res.json();
}

async function loadAll(){
  // Use GitHub Pages CDN (faster cache invalidation after commits).
  // raw.githubusercontent.com has a slower CDN that can serve stale data
  // for minutes-to-hours after a push, causing the version check to
  // incorrectly match localStorage and skip re-fetching new listings.
  const _BASE = siteBase;
  let versionUrl = `${_BASE}/version.json?t=` + Date.now();
  let version = await fetchJsonNoCache(versionUrl);
  currentVersion = String(version.version || "");
  // Force cache refresh if buildVersion changed (e.g., CRM upgraded 2.x → 3.0)
  const _storedBuildVer = localStorage.getItem("listingBuildVersion");
  if(_storedBuildVer && _storedBuildVer !== (version.buildVersion || "")){
    localStorage.removeItem("listingVersion");
    localStorage.removeItem("listingData");
  }
  localStorage.setItem("listingBuildVersion", version.buildVersion || "");
  let cacheVersion = localStorage.getItem("listingVersion");
  if(cacheVersion === currentVersion){
    let cached = localStorage.getItem("listingData");
    if(cached){
      allData = JSON.parse(cached);
      filteredData = [...allData];
      return;
    }
  }
  let pages = Number(version.pages || 0);
  allData = [];
  for(let i = 1; i <= pages; i++){
    let url = `${_BASE}/listings-page-${i}.json?t=` + Date.now();
    let data = await fetchJsonNoCache(url);
    allData = allData.concat(data);
  }
  filteredData = [...allData];
  localStorage.setItem("listingVersion", currentVersion);
  localStorage.setItem("listingData", JSON.stringify(allData));
}

function applySearch(){
  activeSearchPrice = normalizeSearchPriceInput(getSearchInputValue());
  updateResults();
}

function applySort(){
  const sort = document.getElementById("sortSelect");
  currentSort = sort ? sort.value : "default";
  updateResults();
}

function showListings(){
  document.getElementById("property").innerHTML = "";
  const container = document.getElementById("listings");
  container.innerHTML = "";
  let source = filteredData;
  let start = (page - 1) * perPage;
  let items = source.slice(start, start + perPage);
  if(items.length === 0){
    container.innerHTML = `<div class="info">No listings found.</div>`;
    renderPagination();
    return;
  }
  items.forEach(item => {
    let card = document.createElement("div");
    card.className = "card";
    let cover = item.photos?.[0] || "";
    const coverSrc = cover ? withImageSize(cover, 'w400') : 'https://placehold.co/600x400/eeeeee/999999?text=No+Photo';
    const { propType } = parseListingType(item.type);
    card.innerHTML = `
      <a href="?id=${item.id}">
        <div class="image-wrap">
          <div class="img-skeleton"></div>
          <img src="${coverSrc}" loading="lazy" referrerpolicy="no-referrer">
          ${propType ? `<span class="card-badge">${propType}</span>` : ''}
        </div>
        <div class="info">
          <div class="price">${formatPrice(item.price)}</div>
          ${buildAddressHtml(item)}
          ${item.floor ? `<div class="card-floor">${item.floor}</div>` : ''}
          ${buildMetaRowHtml(item)}
        </div>
      </a>
    `;
    let img = card.querySelector("img");
    let skeleton = card.querySelector(".img-skeleton");
    if(img){
      img.addEventListener("load", () => { img.classList.add("loaded"); if(skeleton) skeleton.classList.add("hidden"); });
      img.addEventListener("error", () => { if(skeleton) skeleton.classList.add("hidden"); });
    }
    container.appendChild(card);
  });
  renderPagination();
}

function renderPagination(){
  let nav = document.getElementById("pagination");
  nav.innerHTML = "";
  let totalPages = Math.ceil(filteredData.length / perPage);
  if(totalPages <= 1) return;
  function addButton(label, targetPage, isActive = false, isDisabled = false){
    let button = document.createElement("button");
    button.textContent = label;
    if(isActive) button.className = "active-page";
    if(isDisabled) button.disabled = true;
    if(!isDisabled && !isActive) button.addEventListener("click", () => changePage(targetPage));
    nav.appendChild(button);
  }
  addButton("Previous", page - 1, false, page === 1);
  let pagesToShow = new Set([1, totalPages, page - 1, page, page + 1]);
  Array.from(pagesToShow).filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b).forEach((p, index, arr) => {
    if(index > 0 && p - arr[index - 1] > 1){
      let span = document.createElement("span"); span.textContent = "..."; nav.appendChild(span);
    }
    addButton(String(p), p, p === page, false);
  });
  addButton("Next", page + 1, false, page === totalPages);
}

function changePage(p){
  page = p;
  showListings();
  window.scrollTo(0, 0);
}

/* PROPERTY PAGE (智能识别视频，没有就不显示) */

function showProperty(){
  document.getElementById("listings").innerHTML = "";
  document.getElementById("pagination").innerHTML = "";
  const container = document.getElementById("property");
  const listing = allData.find(l => l.id === id);
  if(!listing){
    container.innerHTML = `<div class="info">Listing not found.</div>`;
    return;
  }

  let photos = Array.isArray(listing.photos) ? listing.photos : [];
  
  // 严格检测视频：只有里面真的有链接，才判定为有视频
  let hasVideo = listing.video && typeof listing.video === 'string' && listing.video.trim() !== "";
  
  // 如果有视频，序列总长度就是照片数+1；如果没有视频，总长度就等于照片数
  let totalItems = photos.length + (hasVideo ? 1 : 0);

  propertyViewState = { listing, index: 0, isDownloading: false };

  const {propType} = parseListingType(listing.type);

  // Build stats chips — only non-empty fields
  const chips = [];
  if (listing.rooms && listing.rooms !== '0') chips.push({label:'Bedrooms', val: listing.rooms});
  if (listing.baths && listing.baths !== '0') chips.push({label:'Bathrooms', val: listing.baths});
  if (listing.parking !== undefined && listing.parking !== null && listing.parking !== '')
    chips.push({label:'Parking', val: listing.parking == 0 ? 'None' : listing.parking});
  if (listing.size && listing.size !== '0') chips.push({label:'Built-up', val: listing.size + ' sqft'});
  if (listing.floor) chips.push({label:'Floor', val: listing.floor});
  if (listing.landWidth && listing.landLength) chips.push({label:'Land', val: `${listing.landWidth} × ${listing.landLength} ft`});
  else if (listing.landWidth) chips.push({label:'Width', val: listing.landWidth + ' ft'});
  else if (listing.landLength) chips.push({label:'Length', val: listing.landLength + ' ft'});
  if (listing.sideLand && listing.sideLand !== '0') chips.push({label:'Side Land', val: listing.sideLand + ' ft'});

  const statsHtml = chips.length
    ? `<div class="property-stats-grid">${chips.map(c=>`<div class="stat-chip"><div class="stat-chip-label">${c.label}</div><div class="stat-chip-val">${c.val}</div></div>`).join('')}</div>`
    : '';

  const addrHtml = buildAddressHtml(listing);

  const hasTags = listing.condition || listing.mainFeatures || listing.features || listing.furnishings;
  let tagsHtml = hasTags ? `<hr class="info-divider">` : '';
  if (listing.condition) tagsHtml += `<div class="tag-section"><div class="tag-section-label">Condition</div><span class="tag">${listing.condition}</span></div>`;
  if (listing.mainFeatures) tagsHtml += `<div class="tag-section"><div class="tag-section-label">Main Features</div>${listing.mainFeatures.split(',').map(f=>`<span class="tag">${f.trim()}</span>`).join('')}</div>`;
  if (listing.features) tagsHtml += `<div class="tag-section"><div class="tag-section-label">Features</div>${listing.features.split(',').map(f=>`<span class="tag">${f.trim()}</span>`).join('')}</div>`;
  if (listing.furnishings) tagsHtml += `<div class="tag-section"><div class="tag-section-label">Furnishings</div>${listing.furnishings.split(',').map(f=>`<span class="tag">${f.trim()}</span>`).join('')}</div>`;

  container.innerHTML = `
    <div class="topbar">
      <button id="backBtn">← Back</button>
      <button id="copyBtn">Copy URL</button>
      <button id="downloadBtn">Download</button>
      ${hasVideo ? `<button id="viewVideoBtn" style="background:#ff6600;">Watch Video</button>` : ""}
    </div>
    <div class="gallery" id="galleryContainer">
      <div class="gallery-skeleton" id="gallerySkeleton"></div>
      <img id="propertyImage" src="" referrerpolicy="no-referrer">
      ${hasVideo ? `
        <div id="videoContainer" style="display:none; width:100%; height:450px;">
          <iframe id="listingIframe" src="" style="width:100%; height:100%; border:none; background:#000;" allow="autoplay"></iframe>
        </div>
      ` : ""}
      ${propType ? `<div class="gallery-type-badge">${propType}</div>` : ''}
      ${totalItems > 1 ? `<span class="photo-counter" id="photoCounter">1 / ${totalItems}</span>` : ''}
      <button class="prev" id="prevBtn">❮</button>
      <button class="next" id="nextBtn">❯</button>
    </div>
    <div class="info">
      <div class="price">${formatPrice(listing.price)}</div>
      ${addrHtml}
      ${statsHtml}
      ${tagsHtml}
    </div>
  `;

  const image = document.getElementById("propertyImage");
  const skeleton = document.getElementById("gallerySkeleton");
  const videoContainer = document.getElementById("videoContainer");
  const listingIframe = document.getElementById("listingIframe");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const viewVideoBtn = document.getElementById("viewVideoBtn");
  const gallery = document.getElementById("galleryContainer");

  let _loadToken = 0; // increments on each navigation — stale load events are ignored

  function updateGallery(){
    if(propertyViewState.index < photos.length){
      image.style.display = "block";
      if(videoContainer) videoContainer.style.display = "none";
      if(listingIframe) listingIframe.src = "";

      const token = ++_loadToken;
      const currentPhoto = photos[propertyViewState.index] || "";
      const newSrc = currentPhoto ? withImageSize(currentPhoto, "w1200") : "";

      // Load off-screen first; only dim + show skeleton after 150ms so
      // cached images feel instant with no blank flash.
      const tmp = new Image();
      const skeletonTimer = setTimeout(() => {
        if(token !== _loadToken) return;
        image.style.opacity = "0.15";
        if(skeleton) skeleton.style.display = "block";
      }, 150);
      const onReady = () => {
        if(token !== _loadToken) return;
        clearTimeout(skeletonTimer);
        if(skeleton) skeleton.style.display = "none";
        image.src = newSrc;
        image.style.opacity = "1";
      };
      tmp.onload  = onReady;
      tmp.onerror = onReady;
      tmp.src = newSrc;

      if(viewVideoBtn) viewVideoBtn.textContent = "Watch Video";

      const nextPhoto = photos[propertyViewState.index + 1] || "";
      if(nextPhoto) preloadImage(withImageSize(nextPhoto, "w1200"));
    } else if (hasVideo) {
      // 只有在确定有视频的情况下，才允许进入显示视频的分支
      image.style.display = "none";
      if(videoContainer && listingIframe) {
        videoContainer.style.display = "block";
        listingIframe.src = getDrivePreviewUrl(listing.video);
      }
      if(viewVideoBtn) viewVideoBtn.textContent = "Show Photos";
    }

    prevBtn.disabled = propertyViewState.index <= 0;
    nextBtn.disabled = propertyViewState.index >= totalItems - 1;
    const counter = document.getElementById("photoCounter");
    if (counter) counter.textContent = `${propertyViewState.index + 1} / ${totalItems}`;
  }

  prevBtn.addEventListener("click", () => {
    if(propertyViewState.index > 0){ propertyViewState.index--; updateGallery(); }
  });

  nextBtn.addEventListener("click", () => {
    if(propertyViewState.index < totalItems - 1){ propertyViewState.index++; updateGallery(); }
  });

  if(viewVideoBtn){
    viewVideoBtn.addEventListener("click", () => {
      propertyViewState.index = (propertyViewState.index === photos.length) ? 0 : photos.length;
      updateGallery();
    });
  }

  // 多指防冲突检测（防止缩放时误触滑动）
  let touchStartX = null;
  gallery.addEventListener('touchstart', e => {
    if (e.touches.length > 1) {
      touchStartX = null;
    } else {
      touchStartX = e.touches[0].clientX;
    }
  }, {passive: true});

  gallery.addEventListener('touchend', e => {
    if (touchStartX === null) return;
    let touchEndX = e.changedTouches[0].clientX;
    let diff = touchStartX - touchEndX;
    if(Math.abs(diff) > 50){
      if(diff > 0 && !nextBtn.disabled) nextBtn.click();
      else if(diff < 0 && !prevBtn.disabled) prevBtn.click();
    }
  }, {passive: true});

  document.getElementById("backBtn").addEventListener("click", () => window.location = "./");
  document.getElementById("copyBtn").addEventListener("click", () => {
    const url = siteBase + "/listing/" + id + ".html";
    navigator.clipboard.writeText(url).then(() => alert("URL Copied"));
  });

  // 下载时使用原始高清大图
  document.getElementById("downloadBtn").addEventListener("click", async () => {
    if(propertyViewState.isDownloading) return;
    const btn = document.getElementById("downloadBtn");
    propertyViewState.isDownloading = true;
    btn.disabled = true;
    try {
      if(typeof JSZip === 'undefined'){
        btn.textContent = "Loading...";
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const zip = new JSZip();
      const folder = zip.folder("photos");
      let saved = 0;
      for(let i = 0; i < photos.length; i++){
        btn.textContent = `${i + 1} / ${photos.length}`;
        try {
          const imgUrl = toDownloadUrl(photos[i]);
          const resp = await fetch(imgUrl, { mode: 'cors' });
          if(!resp.ok) throw new Error();
          folder.file(`photo-${i + 1}.jpg`, await resp.blob());
          saved++;
        } catch(_){ /* skip photos that can't be fetched */ }
      }
      if(saved === 0) throw new Error("no photos");
      btn.textContent = "Zipping...";
      const content = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = "photos.zip";
      a.click();
      btn.textContent = `Done (${saved})`;
    } catch(e){
      btn.textContent = "Failed";
    }
    setTimeout(() => { btn.textContent = "Download"; btn.disabled = false; propertyViewState.isDownloading = false; }, 2500);
  });

  updateGallery();
}

async function init(){
  await loadAll();
  if(id){
    document.querySelector('.toolbar').style.display = 'none';
    showProperty();
  } else {
    const s = document.getElementById("searchInput");
    const o = document.getElementById("sortSelect");
    if(s) s.addEventListener("input", applySearch);
    if(o) o.addEventListener("change", applySort);
    filteredData = [...allData];
    showListings();
  }
}
init();
