const perPage = 50;

let page = 1;
let allData = [];
let filteredData = [];
let currentVersion = "";
let currentSort = "default";
let activeSearchPrice = 0;
let propertyViewState = null;

const id = new URLSearchParams(window.location.search).get("id");

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
  return "RM " + Math.round(num).toLocaleString();
}

function parseTypeAndArea(typeStr){
  if(!typeStr) return { subType: "", area: "" };
  const atIdx = typeStr.indexOf(" @ ");
  if(atIdx === -1) return { subType: typeStr.trim(), area: "" };
  const subType = typeStr.slice(0, atIdx).trim();
  let area = typeStr.slice(atIdx + 3).trim();
  const segments = area.split(",").map(s => s.trim()).filter(Boolean);
  const filtered = segments.filter(s => {
    if(/^(jalan|jln)\b/i.test(s)) return false;
    if(/^\d{5}$/.test(s)) return false;
    if(/^(malaysia|selangor|kuala lumpur|kl|johor|penang|perak|negeri sembilan|pahang|kedah|kelantan|terengganu|perlis|sabah|sarawak|wilayah persekutuan|wp)$/i.test(s)) return false;
    return true;
  });
  const tamanSeg = filtered.find(s => /^(tmn|taman|bdr|bandar)\b/i.test(s));
  if(tamanSeg) return { subType, area: tamanSeg };
  return { subType, area: filtered[filtered.length - 1] || "" };
}

function formatRooms(r,b,p){
  let parts = [];
  if(r) parts.push(r + "R");
  if(b) parts.push(b + "B");
  if(p) parts.push(p + "P");
  return parts.join(" ");
}

function withVersion(url){
  if(!url) return "";
  let secureUrl = url.replace("http://", "https://");
  if(!currentVersion) return secureUrl;
  return secureUrl + (secureUrl.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(currentVersion);
}

function withImageSize(url, size){
  if(!url) return "";

  // 1. 拦截空照片
  if(url.includes("profile/picture/0") || url.includes("profile/picture/2")){
     return "https://placehold.co/600x400/eeeeee/999999?text=No+Photo";
  }

  // 2. 官方极速通道：让照片秒开且无拦截报错
  let match = url.match(/[-\w]{25,}/);
  if(match){
    let fileId = match[0];
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
  let match = url.match(/id=([-\w]{25,})/);
  if (match && match[1]) {
    return `https://drive.google.com/file/d/${match[1]}/preview`;
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
  const _BASE = "https://maccencheong.github.io/listing-site";
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
    let {subType, area} = parseTypeAndArea(item.type);
    card.innerHTML = `
      <a href="?id=${item.id}">
        <div class="image-wrap">
          <div class="img-skeleton"></div>
          <img src="${cover ? withImageSize(cover, 'w600') : ''}" loading="lazy" referrerpolicy="no-referrer">
        </div>
        <div class="info">
          ${subType ? `<span class="type-tag">${subType}</span>` : ""}
          <div class="price">${formatPrice(item.price)}</div>
          ${area ? `<div>${area}</div>` : ""}
          <div>${item.floor || ""}</div>
          <div>${formatRooms(item.rooms, item.baths, item.parking)}</div>
          <div>${item.size || ""} sqft</div>
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

  container.innerHTML = `
    <div class="topbar">
      <button id="backBtn">← Back</button>
      <button id="copyBtn">Copy URL</button>
      <button id="downloadBtn">Download</button>
      ${hasVideo ? `<button id="viewVideoBtn" style="background:#ff6600;">Watch Video</button>` : ""}
    </div>
    <div class="gallery" id="galleryContainer">
      <img id="propertyImage" src="" referrerpolicy="no-referrer">
      ${hasVideo ? `
        <div id="videoContainer" style="display:none; width:100%; height:450px;">
          <iframe id="listingIframe" src="" style="width:100%; height:100%; border:none; background:#000;" allow="autoplay"></iframe>
        </div>
      ` : ""}
      <button class="prev" id="prevBtn">❮</button>
      <button class="next" id="nextBtn">❯</button>
    </div>
    <div class="info">
      ${(()=>{ let {subType,area}=parseTypeAndArea(listing.type); return (subType?`<span class="type-tag">${subType}</span>`:"")+(area?`<div>${area}</div>`:""); })()}
      <div class="price">${formatPrice(listing.price)}</div>
      <div>${listing.floor || ""}</div>
      <div>${formatRooms(listing.rooms, listing.baths, listing.parking)}</div>
      <div>${listing.size || ""} sqft</div>
      ${listing.condition ? `<div><strong>Condition:</strong> ${listing.condition}</div>` : ""}
      ${listing.mainFeatures ? `<div><strong>Main Features:</strong> ${listing.mainFeatures.split(',').map(f=>`<span class="tag">${f.trim()}</span>`).join('')}</div>` : ""}
      ${listing.features ? `<div><strong>Features:</strong> ${listing.features.split(',').map(f=>`<span class="tag">${f.trim()}</span>`).join('')}</div>` : ""}
      ${listing.furnishings ? `<div><strong>Furnishings:</strong> ${listing.furnishings.split(',').map(f=>`<span class="tag">${f.trim()}</span>`).join('')}</div>` : ""}
    </div>
  `;

  const image = document.getElementById("propertyImage");
  const videoContainer = document.getElementById("videoContainer");
  const listingIframe = document.getElementById("listingIframe");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const viewVideoBtn = document.getElementById("viewVideoBtn");
  const gallery = document.getElementById("galleryContainer");

  function updateGallery(){
    if(propertyViewState.index < photos.length){
      // 显示照片
      image.style.display = "block";
      if(videoContainer) videoContainer.style.display = "none";
      if(listingIframe) listingIframe.src = ""; 
      
      let currentPhoto = photos[propertyViewState.index] || "";
      image.src = currentPhoto ? withImageSize(currentPhoto, "w1200") : "";
      if(viewVideoBtn) viewVideoBtn.textContent = "Watch Video";
      
      let nextPhoto = photos[propertyViewState.index + 1] || "";
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

    // 禁用按钮逻辑，如果没有视频，划到最后一张照片右边箭头就会变灰，无法继续滑
    prevBtn.disabled = propertyViewState.index <= 0;
    nextBtn.disabled = propertyViewState.index >= totalItems - 1;
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
    const url = window.location.origin + "/listing-site/listing/" + id + ".html";
    navigator.clipboard.writeText(url).then(() => alert("URL Copied"));
  });

  // 下载时使用原始高清大图
  document.getElementById("downloadBtn").addEventListener("click", async () => {
    if(propertyViewState.isDownloading) return;
    const btn = document.getElementById("downloadBtn");
    propertyViewState.isDownloading = true;
    btn.textContent = "Downloading..."; btn.disabled = true;
    try {
      let zip = new JSZip(); let folder = zip.folder("photos");
      for(let i = 0; i < photos.length; i++){
        let rawUrl = photos[i].replace("http://", "https://");
        let resp = await fetch(rawUrl, { cache: "no-store" });
        folder.file(`photo-${i+1}.jpg`, await resp.blob());
      }
      let content = await zip.generateAsync({type:"blob"});
      let a = document.createElement("a"); a.href = URL.createObjectURL(content); a.download = "photos.zip"; a.click();
      btn.textContent = "Done";
    } catch(e) { alert("Failed"); }
    setTimeout(() => { btn.textContent = "Download"; btn.disabled = false; propertyViewState.isDownloading = false; }, 1200);
  });

  updateGallery();
}

async function init(){
  await loadAll();
  if(id) showProperty();
  else {
    const s = document.getElementById("searchInput");
    const o = document.getElementById("sortSelect");
    if(s) s.addEventListener("input", applySearch);
    if(o) o.addEventListener("change", applySort);
    filteredData = [...allData];
    showListings();
  }
}
init();
