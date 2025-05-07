// Listener que se activa cuando el DOM está completamente cargado y parseado.
document.addEventListener('DOMContentLoaded', () => {
    // Intervalo para verificar si la librería Chart.js se ha cargado.
    const readyStateCheckInterval = setInterval(() => {
        // Si el documento está completo y Chart.js está definido, inicializa la aplicación.
        if (document.readyState === 'complete' && typeof Chart !== 'undefined') {
            clearInterval(readyStateCheckInterval); // Detiene el intervalo.
            EconomicIndicatorsApp.init(); // Llama a la función de inicialización.
        }
    }, 100);

    // Timeout de seguridad por si Chart.js no se carga.
    setTimeout(() => {
        clearInterval(readyStateCheckInterval); // Detiene el intervalo.
        if (typeof Chart !== 'undefined') {
            EconomicIndicatorsApp.init(); // Inicializa si Chart.js está disponible.
        } else {
            // Muestra un error si Chart.js no se pudo cargar.
            const errorContainer = document.getElementById('error-container');
            if (errorContainer) {
                errorContainer.style.display = 'block';
                errorContainer.textContent = 'Error: No se pudo cargar la biblioteca de gráficos. Por favor, recarga la página.';
            }
            const skeletonContainer = document.getElementById('skeleton-container');
            if (skeletonContainer) {
                skeletonContainer.style.display = 'none'; // Oculta el skeleton loader.
            }
        }
    }, 3000);
});

const EconomicIndicatorsApp = (() => {
    // CONFIG: Almacena constantes y configuraciones de la aplicación.
    const CONFIG = {
        API_BASE_URL: 'https://mindicador.cl/api', // URL base de la API.
        CACHE_DURATION: 300000, // Duración de la caché en milisegundos (5 minutos).
        DEFAULT_INDICATOR: 'dolar', // Indicador por defecto al cargar la página.
        DEFAULT_YEAR_COUNT: 5, // Número de años por defecto para comparar.
        CHART_COLORS: [ // Paleta de colores para los gráficos.
            'rgba(52, 152, 219, 1)',
            'rgba(231, 76, 60, 1)',
            'rgba(46, 204, 113, 1)',
            'rgba(155, 89, 182, 1)',
            'rgba(241, 196, 15, 1)',
            'rgba(230, 126, 34, 1)',
            'rgba(52, 73, 94, 1)',
            'rgba(22, 160, 133, 1)',
            'rgba(192, 57, 43, 1)',
            'rgba(142, 68, 173, 1)'
        ],
        INDICATORS: [ // Lista de indicadores disponibles con sus metadatos.
            { code: 'dolar', name: 'Dólar Observado', icon: 'fa-dollar-sign', year_from: 1984, format: '$' },
            { code: 'euro', name: 'Euro', icon: 'fa-euro-sign', year_from: 1999, format: '$' },
            { code: 'uf', name: 'Unidad de Fomento (UF)', icon: 'fa-chart-line', year_from: 1977, format: '$' },
            { code: 'ipc', name: 'IPC', icon: 'fa-percentage', year_from: 1928, format: '%' },
            { code: 'utm', name: 'UTM', icon: 'fa-money-bill-wave', year_from: 1990, format: '$' },
            { code: 'imacec', name: 'Imacec', icon: 'fa-chart-bar', year_from: 1997, format: '%' },
            { code: 'tpm', name: 'TPM', icon: 'fa-university', year_from: 2001, format: '%' },
            { code: 'libra_cobre', name: 'Libra de Cobre', icon: 'fa-coins', year_from: 2012, format: 'US$' },
            { code: 'tasa_desempleo', name: 'Tasa de Desempleo', icon: 'fa-user-minus', year_from: 2009, format: '%' },
            { code: 'bitcoin', name: 'Bitcoin', icon: 'fa-bitcoin-sign', year_from: 2009, format: 'US$' }
        ]
    };

    // state: Almacena el estado dinámico de la aplicación.
    const state = {
        currentChart: null, // Referencia a la instancia actual del gráfico.
        currentIndicator: CONFIG.DEFAULT_INDICATOR, // Indicador actualmente seleccionado.
        yearCount: CONFIG.DEFAULT_YEAR_COUNT, // Número de años seleccionados para comparar.
        dataCache: {}, // Objeto para almacenar datos cacheados de la API.
        fetchController: null, // Controlador para abortar peticiones fetch en curso.
        isLoading: false, // Bandera para indicar si se están cargando datos.
        chartUpdateQueue: [], // Cola para actualizaciones pendientes del gráfico.
        chartCreationTimeoutId: null // ID del timeout para la creación del gráfico (evita recreaciones múltiples).
    };

    // elements: Referencias a elementos del DOM cacheados para mejorar rendimiento.
    const elements = {};

    // utils: Contiene funciones de utilidad reutilizables.
    const utils = {
        // throttle: Limita la frecuencia de ejecución de una función.
        throttle: (callback, limit) => {
            let waiting = false;
            return function() {
                if (!waiting) {
                    callback.apply(this, arguments);
                    waiting = true;
                    setTimeout(() => {
                        waiting = false;
                    }, limit);
                }
            };
        },

        // debounce: Retrasa la ejecución de una función hasta que haya pasado un tiempo sin llamarla.
        debounce: (func, wait) => {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func(...args), wait);
            };
        },

        formatDate: (dateString) => {
            const date = new Date(dateString);
            return date.toLocaleDateString('es-CL');
        },

        formatValue: (value, format) => {
            if (value === null || value === undefined) return 'N/A';

            if (format === '$') {
                return `$${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else if (format === 'US$') {
                return `US$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else if (format === '%') {
                return `${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
            }

            return value.toLocaleString('es-CL');
        },

        // getIndicatorInfo: Obtiene la información de configuración de un indicador por su código.
        getIndicatorInfo: (code) => {
            return CONFIG.INDICATORS.find(ind => ind.code === code);
        },

        // getPastYears: Genera un array con los últimos 'count' años desde el año actual.
        getPastYears: (count) => {
            const currentYear = new Date().getFullYear();
            return Array.from({ length: count }, (_, i) => currentYear - i).reverse();
        },

        generateDayMonthLabels: () => {
            const labels = [];
            const tempDate = new Date(2020, 0, 1); // Use a non-leap year for consistency, Chart.js handles actual dates
            for (let i = 0; i < 366; i++) { // Max 366 days for leap years
                const month = (tempDate.getMonth() + 1).toString().padStart(2, '0');
                const day = tempDate.getDate().toString().padStart(2, '0');
                labels.push(`${month}-${day}`);
                tempDate.setDate(tempDate.getDate() + 1);
                if (tempDate.getMonth() === 0 && tempDate.getDate() === 1 && i > 0) break; // Stop after a full year cycle
            }
            return labels;
        }
    };

    // uiController: Maneja todas las interacciones y actualizaciones de la interfaz de usuario.
    const uiController = {
        init: () => {
            elements.skeletonContainer = document.getElementById('skeleton-container');
            elements.chartContainer = document.querySelector('.chart-container');
            elements.errorContainer = document.getElementById('error-container');
            elements.yearsSelect = document.getElementById('years-select');
            elements.smoothLinesCheckbox = document.getElementById('smooth-lines');
            elements.showPointsCheckbox = document.getElementById('show-points');
            elements.chartTitle = document.getElementById('chart-title');
            elements.lastUpdateElement = document.getElementById('last-update');
            elements.statsContainer = document.getElementById('stats-container');
            elements.tabsContainer = document.getElementById('indicator-tabs');
        },

        // setupTabs: Genera dinámicamente las pestañas de indicadores.
        setupTabs: () => {
            if (!elements.tabsContainer) return;
            elements.tabsContainer.innerHTML = '';
            elements.tabsContainer.setAttribute('role', 'tablist');


            CONFIG.INDICATORS.forEach((indicator, index) => {
                const tab = document.createElement('div');
                tab.className = `tab ${indicator.code === state.currentIndicator ? 'active' : ''}`;
                tab.dataset.indicator = indicator.code;
                tab.setAttribute('role', 'tab');
                tab.setAttribute('id', `tab-${indicator.code}`);
                tab.setAttribute('aria-controls', 'chart-panel');
                tab.setAttribute('aria-selected', indicator.code === state.currentIndicator);
                tab.setAttribute('tabindex', indicator.code === state.currentIndicator ? '0' : '-1');

                tab.innerHTML = `<i class="fas ${indicator.icon} tab-icon"></i>${indicator.name}`;

                const skeletonIndicator = document.createElement('span');
                skeletonIndicator.className = 'tab-skeleton-indicator';
                skeletonIndicator.style.display = 'none'; // Oculto por defecto.
                tab.appendChild(skeletonIndicator);

                // Event listener para el clic en la pestaña (con throttle para evitar clics rápidos).
                tab.addEventListener('click', utils.throttle(function() {
                    if (indicator.code !== state.currentIndicator && !tab.classList.contains('loading')) {
                        document.querySelectorAll('.tab').forEach(t => {
                            t.classList.remove('active');
                            t.setAttribute('aria-selected', 'false');
                            t.setAttribute('tabindex', '-1');
                            const skel = t.querySelector('.tab-skeleton-indicator');
                            if (skel) skel.style.display = 'none';
                        });

                        tab.classList.add('active', 'loading');
                        tab.setAttribute('aria-selected', 'true');
                        tab.setAttribute('tabindex', '0');
                        const currentSkel = tab.querySelector('.tab-skeleton-indicator');
                        if (currentSkel) currentSkel.style.display = 'inline-block';

                        state.currentIndicator = indicator.code;
                        uiController.updateChartTitle();

                        if (state.fetchController) {
                            state.fetchController.abort();
                            state.fetchController = null;
                        }

                        uiController.showSkeletonLoader();

                        // Usa requestAnimationFrame para asegurar que el DOM se actualice antes de cargar datos.
                        window.requestAnimationFrame(() => {
                            const cacheKey = `${state.currentIndicator}_${state.yearCount}`;
                            // Comprueba si hay datos en caché y si no han expirado.
                            if (state.dataCache[cacheKey] && (Date.now() - state.dataCache[cacheKey].timestamp < CONFIG.CACHE_DURATION)) {
                                console.log(`Usando datos cacheados para ${cacheKey}`);
                                uiController.displayCachedData(state.dataCache[cacheKey]);
                                tab.classList.remove('loading');
                                if (currentSkel) currentSkel.style.display = 'none';
                            } else {
                                // Carga nuevos datos si no hay caché válida.
                                dataController.loadData()
                                    .finally(() => { // Se ejecuta siempre, haya éxito o error.
                                        tab.classList.remove('loading');
                                        if (currentSkel) currentSkel.style.display = 'none';
                                    });
                            }
                        });
                    }
                }, 500), false);

                elements.tabsContainer.appendChild(tab);
            });
        },

        // showSkeletonLoader: Muestra los elementos de carga (esqueleto).
        showSkeletonLoader: () => {
            if (elements.chartContainer) elements.chartContainer.style.display = 'none';
            if (elements.skeletonContainer) elements.skeletonContainer.style.display = 'block';
            if (elements.statsContainer) elements.statsContainer.innerHTML = '';
        },

        // hideSkeletonLoader: Oculta los elementos de carga y muestra el contenedor del gráfico.
        hideSkeletonLoader: () => {
            if (elements.skeletonContainer) elements.skeletonContainer.style.display = 'none';
            if (elements.chartContainer) elements.chartContainer.style.display = 'block';
        },

        // updateChartTitle: Actualiza el título del gráfico con el indicador y años seleccionados.
        updateChartTitle: () => {
            const indicator = utils.getIndicatorInfo(state.currentIndicator);
            if (elements.chartTitle && indicator) {
                 elements.chartTitle.textContent = `${indicator.name} - Comparación de los últimos ${state.yearCount} años`;
            }
            const chartCanvas = document.getElementById('indicator-chart');
            if (chartCanvas && indicator) {
                chartCanvas.setAttribute('aria-label', `Gráfico de la evolución del indicador ${indicator.name} durante los últimos ${state.yearCount} años.`);
            }
        },

        // displayCachedData: Muestra los datos que estaban almacenados en caché.
        displayCachedData: (cachedData) => {
            const { chartData, statistics, lastUpdate } = cachedData;

            if (chartData) {
                chartController.updateOrCreateChart(chartData.labels, chartData.datasets);
            }

            if (statistics) {
                uiController.updateStatistics(statistics);
            }

            if (lastUpdate && elements.lastUpdateElement) {
                elements.lastUpdateElement.textContent = lastUpdate;
            }

            uiController.hideSkeletonLoader();
        },

        // updateStatistics: Renderiza las tarjetas de estadísticas.
        updateStatistics: (stats) => {
            if (!elements.statsContainer) return;
            const fragment = document.createDocumentFragment();

            if (stats.length === 0) {
                const noStats = document.createElement('div');
                noStats.className = 'no-data-message';
                noStats.textContent = 'No hay suficientes datos para calcular estadísticas.';
                fragment.appendChild(noStats);
            } else {
                stats.forEach(stat => {
                    const statCard = document.createElement('div');
                    statCard.className = 'stat-card';

                    let changeHtml = '';
                    if (stat.change) {
                        const changeClass = stat.change.isPositive ? 'positive' : 'negative';
                        const changeIcon = stat.change.isPositive ? '↑' : '↓';
                        changeHtml = `
                            <div class="stat-change ${changeClass}">
                                ${changeIcon} ${stat.change.value} (${stat.change.percent}%)
                            </div>
                        `;
                    }

                    statCard.innerHTML = `
                        <div class="stat-title">${stat.title}</div>
                        <div class="stat-value">${stat.value}</div>
                        <div class="stat-subtext">${stat.subtext || ''}</div>
                        ${changeHtml}
                    `;

                    fragment.appendChild(statCard);
                });
            }

            elements.statsContainer.innerHTML = '';
            elements.statsContainer.appendChild(fragment);
        },

        showError: (message) => {
            if (elements.skeletonContainer) elements.skeletonContainer.style.display = 'none';
            if (elements.errorContainer) {
                elements.errorContainer.style.display = 'block';
                elements.errorContainer.textContent = `Error: ${message || 'No se pudieron cargar los datos'}`;
            }
        }
    };

    // chartController: Gestiona la creación, actualización y configuración del gráfico.
    const chartController = {
        chartPluginsConfig: {}, // Initialize as an empty object
        init: () => {
            // Initialize chartPluginsConfig here because 'this' context behaves differently in object literals
            chartController.chartPluginsConfig = {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function(tooltipItems) {
                            if (!tooltipItems || tooltipItems.length === 0) return '';
                            const firstItem = tooltipItems[0];
                            const year = firstItem.dataset.label.split(' ').pop(); // Extrae el año del label del dataset.
                            return `Fecha: ${firstItem.label} (${year})`;
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                const indicatorInfo = utils.getIndicatorInfo(state.currentIndicator);
                                label += utils.formatValue(context.parsed.y, indicatorInfo ? indicatorInfo.format : '');
                            }
                            return label;
                        }
                    }
                },
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 12 },
                        usePointStyle: true,
                        pointStyle: 'rectRounded'
                    }
                },
                interaction: { // Configuración de interacciones.
                    mode: 'nearest', // Interacción con el punto más cercano.
                    axis: 'x', // Interacción a lo largo del eje X.
                    intersect: false
                }
            };
        },

        queueChartUpdate: (datasets, mode = 'default') => {
            state.chartUpdateQueue.push({ datasets, mode });
            chartController.processChartUpdateQueue();
        },

        // processChartUpdateQueue: Procesa las actualizaciones pendientes en la cola.
        processChartUpdateQueue: () => {
            // No procesa si se está creando un gráfico o si no hay gráfico.
            if (state.chartCreationTimeoutId || !state.currentChart) return;

            while (state.chartUpdateQueue.length > 0) {
                const update = state.chartUpdateQueue.shift(); // Saca la primera actualización de la cola.
                try {
                    if (state.currentChart) {
                        state.currentChart.data.datasets = update.datasets;
                        state.currentChart.update(update.mode); // Actualiza el gráfico.
                    }
                } catch (err) {
                    console.warn('Error aplicando actualización al gráfico:', err);
                    state.chartUpdateQueue = []; // Limpia la cola en caso de error para evitar bucles.
                    return;
                }
            }
        },

        // updateOrCreateChart: Destruye el gráfico existente (si hay) y crea uno nuevo.
        updateOrCreateChart: (chartLabels, datasets) => {
            // Cancela cualquier creación de gráfico pendiente.
            if (state.chartCreationTimeoutId) {
                clearTimeout(state.chartCreationTimeoutId);
                state.chartCreationTimeoutId = null;
            }

            const indicator = utils.getIndicatorInfo(state.currentIndicator);

            // Destruye el gráfico anterior si existe.
            if (state.currentChart) {
                try {
                    state.currentChart.destroy();
                } catch (e) {
                    console.warn("Error durante la destrucción del gráfico:", e);
                }
                state.currentChart = null;
            }

            // Usa setTimeout para desacoplar la creación del gráfico del flujo principal y permitir que el DOM se actualice.
            state.chartCreationTimeoutId = setTimeout(() => {
                try {
                    // Recrea el elemento canvas para asegurar una limpieza completa.
                    const canvas = document.getElementById('indicator-chart');
                    if (!canvas) {
                        console.error("Canvas element 'indicator-chart' not found.");
                        uiController.showError("Error interno: Elemento de gráfico no encontrado.");
                        state.chartCreationTimeoutId = null;
                        return;
                    }
                    const parent = canvas.parentNode;
                    parent.removeChild(canvas);

                    const newCanvas = document.createElement('canvas');
                    newCanvas.id = 'indicator-chart';
                    newCanvas.setAttribute('role', 'img');
                    if (indicator) {
                        newCanvas.setAttribute('aria-label', `Gráfico de la evolución del indicador ${indicator.name}`);
                    }


                    parent.appendChild(newCanvas);

                    const ctx = newCanvas.getContext('2d');

                    // Crea la nueva instancia de Chart.
                    state.currentChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: chartLabels,
                            datasets: datasets
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            spanGaps: true, 
                            animation: {
                                duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800
                            },
                            scales: {
                                x: {
                                    title: {
                                        display: true,
                                        text: 'MES',
                                        font: { size: 14 }
                                    },
                                    ticks: {
                                        maxTicksLimit: 12, 
                                        callback: function(value, index, values) {
                                            const label = this.getLabelForValue(value);
                                            if (label && label.endsWith('-01')) { 
                                                const monthIndex = parseInt(label.substring(0, 2)) - 1;
                                                const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
                                                                "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
                                                return monthNames[monthIndex];
                                            }
                                            return null; 
                                        },
                                        autoSkipPadding: 15 
                                    }
                                },
                                y: {
                                    title: {
                                        display: true,
                                        text: `Valor (${indicator ? indicator.format : ''}CLP)`,
                                        font: { size: 14 }
                                    },
                                    beginAtZero: false, 
                                    ticks: {
                                        callback: function(value) {
                                            return utils.formatValue(value, indicator ? indicator.format : '');
                                        }
                                    }
                                }
                            },
                            elements: {
                                line: {
                                    tension: elements.smoothLinesCheckbox && elements.smoothLinesCheckbox.checked ? 0.4 : 0
                                }
                            },
                            plugins: chartController.chartPluginsConfig 
                        }
                    });

                    state.chartCreationTimeoutId = null;
                    chartController.processChartUpdateQueue();

                    uiController.hideSkeletonLoader();

                } catch (error) {
                    console.error("Error creando el gráfico:", error);
                    uiController.showError(`Error al crear el gráfico: ${error.message}`);
                    state.chartCreationTimeoutId = null;
                }
            }, 50);
        },

        // fillDataGaps: Rellena los huecos (valores nulos) en los datasets.
        fillDataGaps: (datasets) => {
            datasets.forEach(dataset => {
                let lastKnownValue = null; // Almacena el último valor no nulo encontrado.

                for (let i = 0; i < dataset.data.length; i++) {
                    if (dataset.data[i] !== null) {
                        lastKnownValue = dataset.data[i];
                    } else if (lastKnownValue !== null) {
                    }
                }

                lastKnownValue = null;
                for (let i = 0; i < dataset.data.length; i++) {
                    if (dataset.data[i] !== null) {
                        lastKnownValue = dataset.data[i];
                    } else {
                        let nextKnownValue = null;
                        let gapEndIndex = i;
                        for (let j = i + 1; j < dataset.data.length; j++) {
                            if (dataset.data[j] !== null) {
                                nextKnownValue = dataset.data[j];
                                gapEndIndex = j;
                                break;
                            }
                        }

                        if (lastKnownValue !== null && nextKnownValue !== null) {
                            const gapSize = gapEndIndex - (i - 1); 
                            const step = (nextKnownValue - lastKnownValue) / gapSize;

                            for (let k = 0; k < (gapEndIndex - i); k++) {
                                dataset.data[i + k] = lastKnownValue + step * (k + 1);
                            }
                            i = gapEndIndex -1; 
                        } else if (lastKnownValue !== null) { 
                             dataset.data[i] = lastKnownValue; 
                        }
                    }
                }
            });
            return datasets;
        }
    };

    // dataController: Responsable de obtener, procesar y cachear los datos de la API.
    const dataController = {
        lastFetchTimestamp: {}, // Registra el timestamp del último fetch para evitar peticiones muy seguidas.

        // fetchDataForYear: Obtiene los datos de un indicador para un año específico.
        // Incluye lógica de reintentos y caché simple basada en tiempo.
        fetchDataForYear: async (year, indicator, retryCount = 0) => {
            try {
                const now = Date.now();
                const fetchKey = `${indicator}_${year}`; // Clave para caché y timestamp.

                // Evita fetches demasiado rápidos para el mismo recurso (ej. clics rápidos).
                if (dataController.lastFetchTimestamp[fetchKey] && now - dataController.lastFetchTimestamp[fetchKey] < 1000) {
                    // Si hay datos en caché reciente, los devuelve.
                    if (state.dataCache[fetchKey] && state.dataCache[fetchKey].data) {
                        console.log(`Usando datos cacheados (fetch rápido) para ${fetchKey}`);
                        return state.dataCache[fetchKey].data;
                    }
                    return null; // Evita la petición si es muy reciente y no hay caché.
                }

                dataController.lastFetchTimestamp[fetchKey] = now;

                if (!state.fetchController) {
                    state.fetchController = new AbortController();
                }

                const response = await fetch(`${CONFIG.API_BASE_URL}/${indicator}/${year}`, {
                    signal: state.fetchController.signal
                });

                if (!response.ok) {
                    if (response.status === 404) { // Si es un 404, no hay datos, no reintentar.
                        console.warn(`No hay datos (404) para ${indicator} ${year}`);
                        state.dataCache[fetchKey] = { data: [], timestamp: now };
                        return [];
                    }
                    if (retryCount < 3) {
                        const delay = Math.pow(2, retryCount) * 1000
                        console.log(`Reintentando fetch para ${indicator} ${year} en ${delay}ms`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        return dataController.fetchDataForYear(year, indicator, retryCount + 1);
                    }
                    throw new Error(`Error HTTP ${response.status}`);
                }

                const data = await response.json();

                // Si no hay 'serie' o está vacía, se considera que no hay datos.
                if (!data.serie || data.serie.length === 0) {
                    console.warn(`No hay datos en la serie para ${indicator} ${year}`);
                    state.dataCache[fetchKey] = { data: [], timestamp: now };
                    return [];
                }

                // Almacena los datos obtenidos en la caché global.
                state.dataCache[fetchKey] = { data: data.serie, timestamp: now };

                return data.serie;
            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log(`Petición para ${indicator} ${year} fue abortada.`);
                    return null; // Retorna null si la petición fue abortada.
                }

                console.error(`Error al cargar datos para ${indicator} ${year}:`, error);
                return null; // Retorna null en caso de otros errores.
            }
        },

        // calculateStatistics: Calcula estadísticas básicas a partir de los datos cargados.
        calculateStatistics: (dataResults) => {
            const stats = [];
            const indicator = utils.getIndicatorInfo(state.currentIndicator);
            if (!indicator) return [];

            // Filtra años que realmente tienen datos.
            const validResults = dataResults.filter(yearData => yearData && yearData.length > 0);

            if (validResults.length === 0) return []; // No hay datos para calcular.

            // Usa los datos del año más reciente con información.
            const latestYearData = validResults[validResults.length - 1];

            if (latestYearData.length === 0) return [];

            // Asume que los datos vienen ordenados por fecha descendente desde la API.
            const latestValue = latestYearData[0].valor;
            const previousValue = latestYearData.length > 1 ? latestYearData[1].valor : null; // Valor del día anterior.

            let change = null;
            let changePercent = null;

            // Calcula el cambio respecto al día anterior.
            if (latestValue !== null && previousValue !== null && previousValue !== 0) {
                change = latestValue - previousValue;
                changePercent = (change / previousValue) * 100;
            }

            let sum = 0;
            let count = 0;
            let minVal = Infinity;
            let maxVal = -Infinity;

            // Calcula promedio, mínimo y máximo del año actual.
            for (const item of latestYearData) {
                const val = item.valor;
                sum += val;
                count++;

                if (val < minVal) minVal = val;
                if (val > maxVal) maxVal = val;
            }

            const currentYearAvg = count > 0 ? sum / count : 0;

            stats.push({
                title: 'Último valor registrado',
                value: utils.formatValue(latestValue, indicator.format),
                subtext: utils.formatDate(latestYearData[0].fecha),
                change: change !== null && changePercent !== null
                    ? {
                        value: change.toFixed(2),
                        percent: changePercent.toFixed(2),
                        isPositive: change > 0
                    }
                    : null
            });

            stats.push({
                title: 'Promedio año actual',
                value: utils.formatValue(currentYearAvg, indicator.format),
                subtext: `Basado en ${count} registros`
            });

            if (minVal !== Infinity) {
                stats.push({
                    title: 'Valor mínimo (año actual)',
                    value: utils.formatValue(minVal, indicator.format),
                    subtext: currentYearAvg !== 0 ? `${((minVal / currentYearAvg - 1) * 100).toFixed(2)}% del promedio` : ''
                });
            }

            if (maxVal !== -Infinity) {
                stats.push({
                    title: 'Valor máximo (año actual)',
                    value: utils.formatValue(maxVal, indicator.format),
                    subtext: currentYearAvg !== 0 ? `${((maxVal / currentYearAvg - 1) * 100).toFixed(2)}% del promedio` : ''
                });
            }

            return stats;
        },

        // loadData: Orquesta la carga de datos para el indicador y años seleccionados.
        loadData: () => {
            // Evita cargas múltiples si ya hay una en progreso.
            if (state.isLoading) {
                console.log("Carga de datos ya en progreso, ignorando petición.");
                return Promise.reject(new Error("Carga de datos ya en progreso"));
            }

            state.isLoading = true;

            return new Promise(async (resolve, reject) => {
                try {
                    if (elements.errorContainer) elements.errorContainer.style.display = 'none';
                    uiController.showSkeletonLoader();
                    uiController.updateChartTitle();

                    const indicator = utils.getIndicatorInfo(state.currentIndicator);
                    if (!indicator) {
                        throw new Error("Indicador no encontrado.");
                    }
                    const yearsToFetch = utils.getPastYears(state.yearCount);

                    const validYearsToFetch = yearsToFetch.filter(year => year >= indicator.year_from);

                    if (validYearsToFetch.length === 0) {
                        throw new Error(`No hay datos disponibles para ${indicator.name} en los años seleccionados (desde ${indicator.year_from}).`);
                    }

                    const chartLabels = utils.generateDayMonthLabels();

                    // Prepara los datasets iniciales (vacíos) para el gráfico.
                    const datasets = validYearsToFetch.map((year, index) => ({
                        label: `${indicator.name} ${year}`,
                        data: new Array(chartLabels.length).fill(null), // Array de nulos.
                        borderColor: CONFIG.CHART_COLORS[index % CONFIG.CHART_COLORS.length],
                        backgroundColor: CONFIG.CHART_COLORS[index % CONFIG.CHART_COLORS.length].replace('1)', '0.1)'),
                        fill: false,
                        tension: elements.smoothLinesCheckbox && elements.smoothLinesCheckbox.checked ? 0.4 : 0,
                        borderWidth: 2,
                        pointRadius: elements.showPointsCheckbox && elements.showPointsCheckbox.checked ? 3 : 0,
                        pointHoverRadius: 5,
                        pointHitRadius: 10
                    }));

                    // Crea o actualiza el gráfico con datasets vacíos para mostrar la estructura.
                    chartController.updateOrCreateChart(chartLabels, datasets);

                    state.fetchController = new AbortController();

                    // Ordena los años para fetching (del más reciente al más antiguo para priorizar datos actuales).
                    const orderedYearsForFetching = [...validYearsToFetch].reverse(); // Fetch most recent first
                    const results = new Array(validYearsToFetch.length).fill(null); // To store results in original year order

                    // Itera sobre los años para obtener sus datos.
                    for (let i = 0; i < orderedYearsForFetching.length; i++) {
                        const year = orderedYearsForFetching[i];
                        // Find the original index for the dataset (validYearsToFetch is oldest to newest)
                        const originalYearIndex = validYearsToFetch.indexOf(year);

                        try {
                            const yearData = await dataController.fetchDataForYear(year, state.currentIndicator);
                            results[originalYearIndex] = yearData; // Guarda el resultado (puede ser null o array vacío).

                            if (yearData && yearData.length > 0) {
                                yearData.forEach(entry => {
                                    const date = new Date(entry.fecha);
                                    const month = (date.getMonth() + 1).toString().padStart(2, '0');
                                    const day = date.getDate().toString().padStart(2, '0');
                                    const labelKey = `${month}-${day}`;
                                    const labelIndex = chartLabels.indexOf(labelKey);

                                    if (labelIndex !== -1 && originalYearIndex !== -1) {
                                        datasets[originalYearIndex].data[labelIndex] = entry.valor;
                                    }
                                });

                                // Rellena huecos y actualiza el gráfico progresivamente.
                                const processedDatasets = chartController.fillDataGaps([...datasets.map(ds => ({...ds, data: [...ds.data]}))]);

                                // Actualiza el gráfico con menos frecuencia para mejorar rendimiento.
                                if (i === 0 || i % 2 === 0 || i === orderedYearsForFetching.length - 1) {
                                    chartController.queueChartUpdate(processedDatasets, 'none');
                                }
                            }
                        } catch (error) {
                            if (error.name === 'AbortError') {
                                console.log("Carga de datos abortada debido a cambio de pestaña/indicador.");
                                throw error;
                            }
                            console.error(`Error obteniendo datos del año ${year}:`, error);
                        }
                    }

                    const finalDatasets = chartController.fillDataGaps([...datasets.map(ds => ({...ds, data: [...ds.data]}))]);
                    chartController.queueChartUpdate(finalDatasets);

                    let lastUpdateText = 'No disponible';
                    if (results.length > 0) {
                        // Busca el último año con datos válidos (results are ordered oldest to newest)
                        const mostRecentYearDataWithData = results.slice().reverse().find(data => data && data.length > 0);
                        if (mostRecentYearDataWithData && mostRecentYearDataWithData.length > 0) {
                            lastUpdateText = utils.formatDate(mostRecentYearDataWithData[0].fecha);
                        }
                    }
                    if (elements.lastUpdateElement) elements.lastUpdateElement.textContent = lastUpdateText;

                    const stats = dataController.calculateStatistics(results); // results is [oldest_data, ..., newest_data]
                    uiController.updateStatistics(stats);

                    const cacheKey = `${state.currentIndicator}_${state.yearCount}`;
                    state.dataCache[cacheKey] = {
                        chartData: {
                            labels: chartLabels,
                            datasets: finalDatasets
                        },
                        statistics: stats,
                        lastUpdate: lastUpdateText,
                        timestamp: Date.now()
                    };

                    uiController.hideSkeletonLoader();
                    state.fetchController = null; // Resetea el AbortController.
                    resolve(); // Resuelve la promesa principal de carga.

                } catch (error) {
                    if (error.name !== 'AbortError') {
                        console.error('Error cargando datos:', error);
                        uiController.showError(error.message || 'No se pudieron cargar los datos');
                    } else {
                        console.log("Carga de datos abortada, limpiando.");
                    }

                    state.fetchController = null;
                    reject(error);

                } finally {
                    state.isLoading = false;
                }
            });
        }
    };

    const eventHandler = {
        init: () => {
            // Función debounced para recargar datos (ej. al cambiar años).
            const debouncedLoadData = utils.debounce(() => {
                if (!state.isLoading) { // Solo carga si no hay otra carga en curso.
                    uiController.showSkeletonLoader();
                    dataController.loadData().catch(err => console.warn("Debounced loadData failed:", err.name === 'AbortError' ? "Aborted" : err));
                }
            }, 500);

            if (elements.yearsSelect) {
                elements.yearsSelect.addEventListener('change', () => {
                    state.yearCount = parseInt(elements.yearsSelect.value);
                    debouncedLoadData();
                });
            }

            if (elements.smoothLinesCheckbox) {
                elements.smoothLinesCheckbox.addEventListener('change', () => {
                    if (state.currentChart) {
                        try {
                            state.currentChart.options.elements.line.tension = elements.smoothLinesCheckbox.checked ? 0.4 : 0;
                            chartController.queueChartUpdate(state.currentChart.data.datasets); // Actualiza el gráfico.
                        } catch (err) {
                            console.warn('Error actualizando tensión de líneas:', err);
                        }
                    }
                });
            }

            if (elements.showPointsCheckbox) {
                elements.showPointsCheckbox.addEventListener('change', () => {
                    if (state.currentChart) {
                        try {
                            const pointRadius = elements.showPointsCheckbox.checked ? 3 : 0;
                            state.currentChart.data.datasets.forEach(dataset => {
                                dataset.pointRadius = pointRadius;
                            });
                            chartController.queueChartUpdate(state.currentChart.data.datasets);
                        } catch (err) {
                            console.warn('Error actualizando visibilidad de puntos:', err);
                        }
                    }
                });
            }

            const handleResize = utils.throttle(() => {
                if (state.currentChart) {
                    try {
                        state.currentChart.resize();
                    } catch (err) {
                        console.warn('Error redimensionando el gráfico:', err);
                    }
                }
            }, 200);

            window.addEventListener('resize', handleResize);

            window.addEventListener('beforeunload', () => {
                if (state.fetchController) {
                    state.fetchController.abort();
                }
                state.dataCache = {}; // Clear cache on unload
                dataController.lastFetchTimestamp = {};
            });
        }
    };

    return {
        // init: Función principal para inicializar la aplicación.
        init: () => {
            uiController.init(); // Inicializa UI (cachea elementos).
            chartController.init(); // Inicializa configuraciones del gráfico.
            uiController.setupTabs(); // Crea las pestañas.
            eventHandler.init(); // Configura manejadores de eventos.
            dataController.loadData().catch(err => console.warn("Initial loadData failed:", err.name === 'AbortError' ? "Aborted" : err)); // Carga los datos iniciales.
        }
    };
})();
