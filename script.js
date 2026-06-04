const API_KEY = "7d1feb68d3e669d4477ba51b4f537b0a";

const $ = (id) => document.getElementById(id);

const searchInput = $("city-input");
const locationBtn = $("location-btn");
const dashboard = $("weather-dashboard");
const errorMsg = $("error-message");
const loader = $("loader");
const largeIconContainer = $("large-weather-icon");
const bgPanel = $("weather-bg-panel");
const recentCitiesContainer = $("recent-cities");
const suggestionsBox = $("suggestions");
const voiceBtn = $("voice-btn");
const favoriteBtn = $("favorite-btn");
const scene = $("weather-scene");

let activeCity = "Kolkata";
let activeLocationLabel = "";
let activeLocationMeta = null;

let tempChart = null;
let humidityChart = null;
let debounceTimer = null;

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function getCityKey(item) {
  if (!item) return "";

  if (typeof item === "string") {
    return normalizeText(item);
  }

  if (item.lat && item.lon) {
    return `${Number(item.lat).toFixed(4)},${Number(item.lon).toFixed(4)}`;
  }

  return normalizeText(`${item.city || ""},${item.label || ""}`);
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toCityObject(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const parts = value.split(",").map((item) => item.trim()).filter(Boolean);

    return {
      city: parts[0] || value,
      label: parts.slice(1).join(", "),
      lat: null,
      lon: null
    };
  }

  return {
    city: value.city || value.name || "",
    label: value.label || "",
    lat: value.lat ?? null,
    lon: value.lon ?? null
  };
}

function getCountryName(countryCode) {
  try {
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(countryCode) || countryCode;
  } catch {
    return countryCode;
  }
}

function buildLocationLabel(geo) {
  const countryName = getCountryName(geo.country);
  return geo.state ? `${geo.state}, ${countryName}` : countryName;
}

function scoreGeoResult(item, query) {
  const fullQuery = normalizeText(query);
  const primaryQuery = normalizeText(query.split(",")[0]);

  const itemName = normalizeText(item.name);
  const itemState = normalizeText(item.state || "");
  const itemCountryCode = normalizeText(item.country || "");
  const itemCountryName = normalizeText(getCountryName(item.country || ""));

  let score = 0;

  if (itemName === fullQuery) score += 120;
  if (itemName === primaryQuery) score += 100;
  if (itemName.startsWith(primaryQuery)) score += 50;
  if (itemName.includes(primaryQuery)) score += 25;

  if (item.local_names) {
    const localNames = Object.values(item.local_names).map(normalizeText);

    if (localNames.includes(fullQuery)) score += 110;
    if (localNames.includes(primaryQuery)) score += 90;
  }

  if (itemState && fullQuery.includes(itemState)) score += 40;
  if (itemCountryName && fullQuery.includes(itemCountryName)) score += 40;
  if (itemCountryCode && fullQuery.includes(itemCountryCode)) score += 30;

  if (item.state) score += 5;

  return score;
}

function pickBestGeoResult(geoData, query) {
  return [...geoData].sort(
    (a, b) => scoreGeoResult(b, query) - scoreGeoResult(a, query)
  )[0];
}

function formatTime(unixTime, tzOffsetSeconds, withAmPm = true) {
  // tzOffsetSeconds is OpenWeather's city timezone offset from UTC in seconds
  const d = new Date(unixTime * 1000);

  // Convert to the target timezone by shifting the date value.
  const localMs = d.getTime() + tzOffsetSeconds * 1000;
  const local = new Date(localMs);

  let hours24 = local.getUTCHours();
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");

  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;

  return withAmPm ? `${hours12}:${minutes} ${ampm}` : `${hours12}:${minutes}`;
}

function formatDate(unixTime, tzOffsetSeconds) {
  const localMs = new Date(unixTime * 1000).getTime() + tzOffsetSeconds * 1000;
  const local = new Date(localMs);

  const weekday = local.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC"
  });

  const day = local.toLocaleDateString("en-US", {
    day: "2-digit",
    timeZone: "UTC"
  });

  const month = local.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC"
  });

  return `${weekday} • ${day} ${month}`;
}

function formatTimeParts(unixTime, tzOffsetSeconds) {
  const localMs = new Date(unixTime * 1000).getTime() + tzOffsetSeconds * 1000;
  const local = new Date(localMs);

  const hours24 = local.getUTCHours();
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");

  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;

  return {
    time: `${hours12}:${minutes}`,
    ampm
  };
}


function getLocationLabel(data) {
  if (activeLocationLabel) {
    return activeLocationLabel;
  }

  return getCountryName(data.sys.country);
}

function showLoader(show) {
  if (loader) {
    loader.style.display = show ? "flex" : "none";
  }
}

function showError(message = "") {
  if (!errorMsg) return;

  errorMsg.style.display = "flex";
  errorMsg.innerHTML = `
    <i class="fa-solid fa-triangle-exclamation"></i>
    ${message || "Weather data load nahi ho raha. Please try again."}
  `;
}

function hideError() {
  if (errorMsg) {
    errorMsg.style.display = "none";
  }
}

function getCache(key) {
  const raw = localStorage.getItem(key);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const tenMinutes = 10 * 60 * 1000;

    if (Date.now() - parsed.createdAt > tenMinutes) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  localStorage.setItem(
    key,
    JSON.stringify({
      createdAt: Date.now(),
      data
    })
  );
}

async function fetchJSON(url) {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong");
  }

  return data;
}

function getWeatherIconHTML(weatherCondition, iconCode = "01d", additionalClasses = "") {
  const isDay = iconCode.includes("d");

  let iconClass = "fa-cloud";
  let colorClass = "icon-cloudy";

  if (weatherCondition === "Clear") {
    iconClass = isDay ? "fa-sun" : "fa-moon";
    colorClass = isDay ? "icon-sunny" : "icon-moon";
  } else if (weatherCondition === "Clouds") {
    iconClass = "fa-cloud";
    colorClass = "icon-cloudy";
  } else if (["Rain", "Drizzle"].includes(weatherCondition)) {
    iconClass = "fa-cloud-rain";
    colorClass = "icon-rainy";
  } else if (weatherCondition === "Thunderstorm") {
    iconClass = "fa-cloud-bolt";
    colorClass = "icon-thunder";
  } else if (weatherCondition === "Snow") {
    iconClass = "fa-snowflake";
    colorClass = "icon-snowy";
  } else if (["Mist", "Haze", "Fog", "Smoke", "Dust", "Sand", "Ash"].includes(weatherCondition)) {
    iconClass = "fa-smog";
    colorClass = "icon-cloudy";
  }

  return `<i class="fa-solid ${iconClass} ${colorClass} ${additionalClasses}"></i>`;
}

function getOpenMeteoIconHTML(code, additionalClasses = "") {
  let iconClass = "fa-cloud";
  let colorClass = "icon-cloudy";
  let condition = "Cloudy";

  if (code === 0) {
    iconClass = "fa-sun";
    colorClass = "icon-sunny";
    condition = "Clear";
  } else if ([1, 2, 3].includes(code)) {
    iconClass = "fa-cloud-sun";
    colorClass = "icon-cloudy";
    condition = "Cloudy";
  } else if ([45, 48].includes(code)) {
    iconClass = "fa-smog";
    colorClass = "icon-cloudy";
    condition = "Fog";
  } else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    iconClass = "fa-cloud-rain";
    colorClass = "icon-rainy";
    condition = "Rain";
  } else if ([71, 73, 75, 77, 85, 86].includes(code)) {
    iconClass = "fa-snowflake";
    colorClass = "icon-snowy";
    condition = "Snow";
  } else if ([95, 96, 99].includes(code)) {
    iconClass = "fa-cloud-bolt";
    colorClass = "icon-thunder";
    condition = "Thunder";
  }

  return {
    icon: `<i class="fa-solid ${iconClass} ${colorClass} ${additionalClasses}"></i>`,
    condition
  };
}

async function getWeatherData(city) {
  const cleanCity = city.trim();

  if (!cleanCity) {
    showError("Please enter a city name.");
    return;
  }

  if (suggestionsBox) {
    suggestionsBox.style.display = "none";
  }

  hideError();
  showLoader(true);

  try {
    const geoData = await fetchJSON(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(cleanCity)}&limit=8&appid=${API_KEY}`
    );

    if (!geoData || geoData.length === 0) {
      throw new Error("city not found");
    }

    const geo = pickBestGeoResult(geoData, cleanCity);
    const lat = geo.lat;
    const lon = geo.lon;
    const locationLabel = buildLocationLabel(geo);

    await getWeatherByCoords(geo.name, lat, lon, locationLabel);
  } catch (error) {
    console.error("Weather Error:", error.message);

    if (dashboard) {
      dashboard.style.display = "none";
    }

    const msg = error.message.toLowerCase();

    if (msg.includes("invalid api key") || msg.includes("401")) {
      showError("API key invalid hai. OpenWeather API key check karo.");
    } else if (msg.includes("city not found") || msg.includes("not found")) {
      showError("City not found. Please correct city name and try again.");
    } else if (msg.includes("limit") || msg.includes("429")) {
      showError("API limit over ho gayi hai. Thodi der baad try karo.");
    } else {
      showError("Weather data load nahi ho raha. Internet/API key check karo.");
    }

    showLoader(false);
  }
}

async function getWeatherByCoords(cityName, lat, lon, locationLabel = "") {
  if (!cityName || !lat || !lon) return;

  activeCity = cityName;
  activeLocationLabel = locationLabel || "";
  activeLocationMeta = {
    city: cityName,
    label: activeLocationLabel,
    lat,
    lon
  };

  if (suggestionsBox) {
    suggestionsBox.style.display = "none";
  }

  hideError();
  showLoader(true);

  try {
    const cacheKey = `weather-v12-coords-${Number(lat).toFixed(4)}-${Number(lon).toFixed(4)}`;
    let bundle = getCache(cacheKey);

    if (!bundle) {
      const currentData = await fetchJSON(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`
      );

      currentData.name = cityName;

      const [forecastData, aqiData, dailyData] = await Promise.all([
        fetchJSON(
          `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`
        ),
        fetchJSON(
          `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`
        ),
        fetchJSON(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`
        )
      ]);

      bundle = {
        currentData,
        forecastData,
        aqiData,
        dailyData,
        locationLabel: activeLocationLabel,
        locationMeta: activeLocationMeta
      };

      setCache(cacheKey, bundle);
    }

    const { currentData, forecastData, aqiData, dailyData, locationLabel, locationMeta } = bundle;

    activeLocationLabel = locationLabel || "";
    activeLocationMeta = locationMeta || activeLocationMeta;
    activeCity = currentData.name;

    updateCurrentWeatherUI(currentData);
    updateAQIUI(aqiData.list[0]);
    updateForecastUI(forecastData.list, currentData.timezone, dailyData);
    updateCharts(forecastData.list, currentData.timezone);
    updateAIAdvice(currentData, forecastData.list, aqiData.list[0]);
    updateScene(currentData.weather[0].main, currentData.weather[0].icon);
    saveRecentCity(activeLocationMeta);
    animateSunPosition(currentData.sys.sunrise, currentData.sys.sunset, currentData.timezone);
    updateFavoriteButton();

    dashboard.classList.remove("animate-in");
    void dashboard.offsetWidth;
    dashboard.classList.add("animate-in");
    dashboard.style.display = "grid";

    displayRecentCities();
  } catch (error) {
    console.error("Weather Coords Error:", error.message);

    if (dashboard) {
      dashboard.style.display = "none";
    }

    showError("Weather data load nahi ho raha. Internet/API key check karo.");
  } finally {
    showLoader(false);
  }
}

function updateCurrentWeatherUI(data) {
  const timezone = data.timezone;

  $("city-name").innerText = data.name;

  const nowUnix = Math.floor(Date.now() / 1000);
  const timeParts = formatTimeParts(nowUnix, timezone);

  $("country-name").innerText = getLocationLabel(data);

  $("current-time").innerHTML = `
    ${timeParts.time}
    <span class="time-ampm">${timeParts.ampm}</span>
  `;

  $("current-date").innerText = formatDate(nowUnix, timezone);

  if ($("last-updated")) {
    $("last-updated").style.display = "none";
  }

  $("main-temp").innerText = `${Math.round(data.main.temp)}°C`;
  $("feels-like").innerText = `${Math.round(data.main.feels_like)}°C`;

  $("sunrise").innerText = formatTime(data.sys.sunrise, timezone);
  $("sunset").innerText = formatTime(data.sys.sunset, timezone);

  const description = data.weather[0].description;

  $("weather-condition").innerText =
    description.charAt(0).toUpperCase() + description.slice(1);

  largeIconContainer.innerHTML = getWeatherIconHTML(
    data.weather[0].main,
    data.weather[0].icon
  );

  updatePanelBackground(data.weather[0].main, data.weather[0].icon);

  $("humidity").innerText = `${data.main.humidity}%`;
  $("wind-speed").innerText = `${Math.round(data.wind.speed * 3.6)} km/h`;
  $("pressure").innerText = `${data.main.pressure} hPa`;
  $("visibility").innerText = `${((data.visibility || 0) / 1000).toFixed(1)} km`;
}

function updatePanelBackground(weatherCondition, iconCode) {
  const isDay = iconCode.includes("d");

  bgPanel.className = "weather-info-primary";

  if (["Rain", "Drizzle", "Thunderstorm"].includes(weatherCondition)) {
    bgPanel.classList.add("bg-rainy");
  } else if (weatherCondition === "Snow") {
    bgPanel.classList.add("bg-snowy");
  } else if (weatherCondition === "Clear") {
    bgPanel.classList.add(isDay ? "bg-sunny" : "bg-clear-night");
  } else {
    bgPanel.classList.add("bg-cloudy");
  }
}

function updateScene(condition, iconCode) {
  scene.className = "weather-scene";

  if (["Rain", "Drizzle", "Thunderstorm"].includes(condition)) {
    scene.classList.add("rain");
  } else if (condition === "Clear") {
    scene.classList.add(iconCode.includes("d") ? "sunny" : "night");
  } else {
    scene.classList.add("clouds");
  }
}

function updateAQIUI(aqiItem) {
  const aqi = aqiItem.main.aqi;
  const components = aqiItem.components;

  const descriptions = [
    "Unknown",
    "Good air quality. Perfect for outdoor plans.",
    "Fair air quality. Usually okay for most people.",
    "Moderate pollution. Sensitive people should be careful.",
    "Poor air quality. Avoid long outdoor exposure.",
    "Very poor air quality. Mask recommended outside."
  ];

  $("aqi-badge").innerText = `AQI ${aqi}`;
  $("aqi-text").innerText = descriptions[aqi] || "AQI details unavailable.";
  $("aqi-fill").style.width = `${Math.min(aqi * 20, 100)}%`;

  $("pm25").innerText = Math.round(components.pm2_5 ?? 0);
  $("pm10").innerText = Math.round(components.pm10 ?? 0);
  $("co").innerText = Math.round(components.co ?? 0);
  $("no2").innerText = Math.round(components.no2 ?? 0);
}

function updateForecastUI(forecastList, timezone, dailyData = null) {
  const hourlyContainer = $("hourly-container");
  const sevenDayContainer = $("seven-day-container");

  hourlyContainer.innerHTML = "";
  sevenDayContainer.innerHTML = "";

  forecastList.slice(0, 8).forEach((item) => {
    hourlyContainer.innerHTML += `
      <div class="hourly-item">
        <span>${formatTime(item.dt, timezone, false)}</span>
        ${getWeatherIconHTML(item.weather[0].main, item.weather[0].icon, "animated-weather-icon")}
        <span>${Math.round(item.main.temp)}°C</span>
      </div>
    `;
  });

  if (dailyData && dailyData.daily) {
    const dates = dailyData.daily.time;
    const maxTemps = dailyData.daily.temperature_2m_max;
    const minTemps = dailyData.daily.temperature_2m_min;
    const codes = dailyData.daily.weather_code;

    dates.forEach((date, index) => {
      const dateObj = new Date(date + "T00:00:00");

      const dayName = dateObj.toLocaleDateString("en-US", {
        weekday: "long"
      });

      const shortDate = dateObj.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short"
      });

      const weather = getOpenMeteoIconHTML(codes[index], "animated-weather-icon");

      sevenDayContainer.innerHTML += `
        <div class="forecast-item">
          ${weather.icon}

          <span>
            <strong>${Math.round(maxTemps[index])}° / ${Math.round(minTemps[index])}°C</strong>
            <br>
            <small>${weather.condition}</small>
          </span>

          <span>
            ${dayName}
            <br>
            <small>${shortDate}</small>
          </span>
        </div>
      `;
    });
  }
}

function updateCharts(forecastList, timezone) {
  const nextItems = forecastList.slice(0, 8);

  const labels = nextItems.map((item) => formatTime(item.dt, timezone, false));
  const temps = nextItems.map((item) => Math.round(item.main.temp));
  const humidity = nextItems.map((item) => item.main.humidity);

  const textColor = getComputedStyle(document.body)
    .getPropertyValue("--text-muted")
    .trim();

  const gridColor = document.body.classList.contains("dark-mode")
    ? "rgba(255,255,255,.1)"
    : "rgba(15,23,42,.08)";

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      x: {
        ticks: {
          color: textColor
        },
        grid: {
          color: gridColor
        }
      },
      y: {
        ticks: {
          color: textColor
        },
        grid: {
          color: gridColor
        }
      }
    }
  };

  if (tempChart) tempChart.destroy();
  if (humidityChart) humidityChart.destroy();

  tempChart = new Chart($("tempChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: temps,
          borderWidth: 3,
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: baseOptions
  });

  humidityChart = new Chart($("humidityChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: humidity,
          borderWidth: 1,
          borderRadius: 10
        }
      ]
    },
    options: baseOptions
  });
}

function updateAIAdvice(current, forecastList, aqiItem) {
  const temp = current.main.temp;
  const condition = current.weather[0].main;
  const windKmh = current.wind.speed * 3.6;

  const rainComing = forecastList
    .slice(0, 4)
    .some((item) =>
      ["Rain", "Drizzle", "Thunderstorm"].includes(item.weather[0].main)
    );

  const aqi = aqiItem.main.aqi;

  const tags = [];
  const advice = [];

  if (temp >= 35) {
    advice.push("Bahut garmi hai, afternoon travel avoid karo aur water bottle carry karo.");
    tags.push("Hydration", "Avoid noon");
  } else if (temp <= 15) {
    advice.push("Thand feel hogi, jacket ya hoodie le jana better rahega.");
    tags.push("Warm clothes");
  } else {
    advice.push("Temperature comfortable hai, outdoor plan ke liye weather decent lag raha hai.");
    tags.push("Outdoor friendly");
  }

  if (rainComing || ["Rain", "Drizzle", "Thunderstorm"].includes(condition)) {
    advice.push("Agle kuch hours me rain chance hai, umbrella ya raincoat carry karo.");
    tags.push("Umbrella");
  }

  if (windKmh > 25) {
    advice.push("Wind speed high hai, bike ride me careful rehna.");
    tags.push("Wind alert");
  }

  if (aqi >= 4) {
    advice.push("Air quality poor hai, long outdoor exposure avoid karo aur mask use karo.");
    tags.push("Mask recommended");
  }

  $("ai-summary").innerText = advice.join(" ");
  $("ai-tags").innerHTML = tags
    .map((tag) => `<span class="ai-tag">${tag}</span>`)
    .join("");
}

function animateSunPosition(sunrise, sunset, timezone) {
  const svgSun = $("svg-sun");
  const svgFill = $("svg-fill");

  if (!svgSun || !svgFill) return;

  const nowUTC = Date.now() / 1000;
  const localUnixNow = nowUTC + timezone;
  const localSunrise = sunrise + timezone;

  let cycleStartUTC;
  let cycleMidUTC;
  let cycleEndUTC;

  if (localUnixNow < localSunrise) {
    cycleStartUTC = sunrise - 86400;
    cycleMidUTC = sunset - 86400;
    cycleEndUTC = sunrise;
  } else {
    cycleStartUTC = sunrise;
    cycleMidUTC = sunset;
    cycleEndUTC = sunrise + 86400;
  }

  const noonTimeUTC = cycleStartUTC + (cycleMidUTC - cycleStartUTC) / 2;
  const midnightTimeUTC = cycleMidUTC + (cycleEndUTC - cycleMidUTC) / 2;

  $("svg-label-left-time").textContent = formatTime(cycleStartUTC, timezone, false);
  $("svg-label-noon-time").textContent = formatTime(noonTimeUTC, timezone, false);
  $("svg-label-mid-time").textContent = formatTime(cycleMidUTC, timezone, false);
  $("svg-label-midnight-time").textContent = formatTime(midnightTimeUTC, timezone, false);
  $("svg-label-right-time").textContent = formatTime(cycleEndUTC, timezone, false);

  let targetOffset;
  let isNightTime;

  if (nowUTC <= cycleMidUTC) {
    targetOffset = ((nowUTC - cycleStartUTC) / (cycleMidUTC - cycleStartUTC)) * 0.5;
    isNightTime = false;

    $("svg-label-left-text").textContent = "SUNRISE";
    $("svg-label-mid-text").textContent = "SUNSET";
  } else {
    targetOffset = 0.5 + ((nowUTC - cycleMidUTC) / (cycleEndUTC - cycleMidUTC)) * 0.5;
    isNightTime = true;

    $("svg-label-left-text").textContent = "PAST SUNRISE";
    $("svg-label-mid-text").textContent = "SUNSET";
  }

  $("svg-label-right-text").textContent = "NEXT SUNRISE";

  svgSun.innerHTML = isNightTime
    ? `
      <circle cx="0" cy="0" r="14" fill="rgba(148,163,184,.22)" />
      <circle cx="0" cy="0" r="7" fill="#94a3b8" />
    `
    : `
      <circle cx="0" cy="0" r="14" fill="rgba(253,184,19,.28)" />
      <circle cx="0" cy="0" r="7" fill="#FDB813" />
    `;

  svgSun.style.transition = "none";
  svgFill.style.transition = "none";
  svgSun.style.offsetDistance = "0%";
  svgFill.style.clipPath = "inset(0 100% 0 0)";

  void svgSun.offsetWidth;

  svgSun.style.transition = "offset-distance 2.5s cubic-bezier(.4,0,.2,1)";
  svgFill.style.transition = "clip-path 2.5s cubic-bezier(.4,0,.2,1)";

  setTimeout(() => {
    const safeOffset = Math.max(0, Math.min(targetOffset, 1));

    svgSun.style.offsetDistance = `${safeOffset * 100}%`;
    svgFill.style.clipPath = `inset(0 ${100 - safeOffset * 100}% 0 0)`;
  }, 100);
}

/* Recent + Favorite Logic */

function getRecentCities() {
  const data = JSON.parse(localStorage.getItem("recentCitiesV12")) || [];
  return data.map(toCityObject).filter((item) => item && item.city);
}

function setRecentCities(cities) {
  localStorage.setItem("recentCitiesV12", JSON.stringify(cities));
}

function getFavorites() {
  const data = JSON.parse(localStorage.getItem("favoriteCitiesV12")) || [];
  return data.map(toCityObject).filter((item) => item && item.city);
}

function setFavorites(cities) {
  localStorage.setItem("favoriteCitiesV12", JSON.stringify(cities));
}

function uniqueCities(cities) {
  const seen = new Set();

  return cities.filter((city) => {
    const obj = toCityObject(city);
    if (!obj) return false;

    const key = getCityKey(obj);

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function getFinalCityChips() {
  const favorites = uniqueCities(getFavorites()).slice(0, 5);
  const favoriteKeys = favorites.map(getCityKey);

  const recent = uniqueCities(getRecentCities()).filter(
    (city) => !favoriteKeys.includes(getCityKey(city))
  );

  return uniqueCities([...favorites, ...recent]).slice(0, 5);
}

function saveRecentCity(cityData) {
  const cityObj = toCityObject(cityData);
  if (!cityObj || !cityObj.city) return;

  const favorites = uniqueCities(getFavorites()).slice(0, 5);
  const favoriteKeys = favorites.map(getCityKey);

  let recent = uniqueCities(getRecentCities());

  recent = recent.filter(
    (item) => getCityKey(item) !== getCityKey(cityObj)
  );

  if (!favoriteKeys.includes(getCityKey(cityObj))) {
    recent.unshift(cityObj);
  }

  const normalRecent = uniqueCities(recent).filter(
    (item) => !favoriteKeys.includes(getCityKey(item))
  );

  const finalRecent = uniqueCities([
    ...favorites,
    ...normalRecent
  ]).slice(0, 5);

  setRecentCities(finalRecent);
}

function displayRecentCities() {
  const finalCities = getFinalCityChips();
  const favorites = uniqueCities(getFavorites()).slice(0, 5);
  const favoriteKeys = favorites.map(getCityKey);

  setRecentCities(finalCities);

  recentCitiesContainer.innerHTML = finalCities
    .map((item) => {
      const city = toCityObject(item);
      const isFav = favoriteKeys.includes(getCityKey(city));

      const latAttr = city.lat ? `data-lat="${escapeHTML(city.lat)}"` : "";
      const lonAttr = city.lon ? `data-lon="${escapeHTML(city.lon)}"` : "";
      const labelAttr = city.label ? `data-label="${escapeHTML(city.label)}"` : "";

      return `
        <span 
          class="city-chip ${isFav ? "recent-fav-chip" : ""}"
          data-city="${escapeHTML(city.city)}"
          ${latAttr}
          ${lonAttr}
          ${labelAttr}
        >
          ${isFav ? `<i class="fa-solid fa-star"></i>` : ""}
          ${escapeHTML(city.city)}
        </span>
      `;
    })
    .join("");
}

function updateFavoriteButton() {
  const currentObj = activeLocationMeta || {
    city: activeCity,
    label: activeLocationLabel
  };

  const isFavorite = getFavorites().some(
    (city) => getCityKey(city) === getCityKey(currentObj)
  );

  favoriteBtn.classList.toggle("active", isFavorite);

  favoriteBtn.innerHTML = isFavorite
    ? `<i class="fa-solid fa-star"></i>`
    : `<i class="fa-regular fa-star"></i>`;
}

favoriteBtn.addEventListener("click", () => {
  const currentObj = activeLocationMeta || {
    city: activeCity,
    label: activeLocationLabel
  };

  let favorites = uniqueCities(getFavorites());

  const exists = favorites.some(
    (city) => getCityKey(city) === getCityKey(currentObj)
  );

  if (exists) {
    favorites = favorites.filter(
      (city) => getCityKey(city) !== getCityKey(currentObj)
    );
  } else {
    favorites = uniqueCities([currentObj, ...favorites]).slice(0, 5);
  }

  setFavorites(favorites);
  saveRecentCity(currentObj);
  updateFavoriteButton();
  displayRecentCities();
});

async function showCitySuggestions(query) {
  if (query.trim().length < 2) {
    suggestionsBox.style.display = "none";
    return;
  }

  try {
    const data = await fetchJSON(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=8&appid=${API_KEY}`
    );

    suggestionsBox.innerHTML = data
      .map((item) => {
        const countryName = getCountryName(item.country);
        const label = buildLocationLabel(item);

        return `
          <div 
            class="suggestion-item"
            data-city="${escapeHTML(item.name)}"
            data-lat="${escapeHTML(item.lat)}"
            data-lon="${escapeHTML(item.lon)}"
            data-label="${escapeHTML(label)}"
          >
            <strong>${escapeHTML(item.name)}</strong>
            <small>${escapeHTML(item.state ? item.state + ", " : "")}${escapeHTML(countryName)}</small>
          </div>
        `;
      })
      .join("");

    suggestionsBox.style.display = data.length ? "block" : "none";
  } catch {
    suggestionsBox.style.display = "none";
  }
}

searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    showCitySuggestions(searchInput.value);
  }, 350);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    getWeatherData(searchInput.value);
  }
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-city]");

  if (target) {
    searchInput.value = target.dataset.city;

    if (target.dataset.lat && target.dataset.lon) {
      getWeatherByCoords(
        target.dataset.city,
        Number(target.dataset.lat),
        Number(target.dataset.lon),
        target.dataset.label || ""
      );
    } else {
      getWeatherData(target.dataset.city);
    }
  }

  if (!event.target.closest(".search-wrap")) {
    suggestionsBox.style.display = "none";
  }
});

locationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported in this browser.");
    return;
  }

  showLoader(true);

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        const reverseGeo = await fetchJSON(
          `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${API_KEY}`
        );

        const place = reverseGeo && reverseGeo[0];

        if (place) {
          const label = buildLocationLabel(place);
          searchInput.value = place.name;
          getWeatherByCoords(place.name, place.lat, place.lon, label);
        } else {
          const data = await fetchJSON(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`
          );

          searchInput.value = data.name;
          getWeatherByCoords(data.name, lat, lon, getCountryName(data.sys.country));
        }
      } catch (error) {
        console.error("Location Weather Error:", error.message);
        showLoader(false);
        showError("Current location ka weather load nahi ho raha.");
      }
    },
    () => {
      showLoader(false);
      showError("Location permission denied. Search box me city type karo.");
    }
  );
});

$("theme-toggle").addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");

  const isDark = document.body.classList.contains("dark-mode");

  localStorage.setItem("weatherThemeV12", isDark ? "dark" : "light");

  $("theme-toggle").querySelector("i").className = isDark
    ? "fa-solid fa-sun"
    : "fa-solid fa-moon";

  if (dashboard.style.display !== "none") {
    if (activeLocationMeta && activeLocationMeta.lat && activeLocationMeta.lon) {
      getWeatherByCoords(
        activeLocationMeta.city,
        activeLocationMeta.lat,
        activeLocationMeta.lon,
        activeLocationMeta.label
      );
    } else {
      getWeatherData(activeCity);
    }
  }
});

function setupVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceBtn.style.display = "none";
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "en-IN";
  recognition.interimResults = false;

  recognition.onstart = () => {
    voiceBtn.classList.add("listening");
  };

  recognition.onend = () => {
    voiceBtn.classList.remove("listening");
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript
      .replace(/weather/gi, "")
      .trim();

    searchInput.value = transcript;
    getWeatherData(transcript);
  };

  voiceBtn.addEventListener("click", () => {
    recognition.start();
  });
}

function initTheme() {
  if (localStorage.getItem("weatherThemeV12") === "dark") {
    document.body.classList.add("dark-mode");
    $("theme-toggle").querySelector("i").className = "fa-solid fa-sun";
  }
}

function init() {
  initTheme();
  displayRecentCities();
  setupVoiceSearch();

  setTimeout(() => {
    getWeatherData("Kolkata, West Bengal, India");
  }, 300);
}

init();
