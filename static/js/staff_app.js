document.addEventListener('DOMContentLoaded', function() {

    function displayAlert(elementOrId, message, type = 'info', dismissible = true, isHtml = false) {
        const element = (typeof elementOrId === 'string') ? document.getElementById(elementOrId) : elementOrId;
        if (!element) return;

        let content = isHtml ? message : String(message);

        let alertHtml = `<div class="alert alert-${type} ${dismissible ? 'alert-dismissible fade show' : ''} small" role="alert">
                        ${content}`;
        if (dismissible) {
            alertHtml += '<button type="button" class="btn-close btn-sm" data-bs-dismiss="alert" aria-label="Close"></button>';
        }
        alertHtml += '</div>';
        element.innerHTML = alertHtml;
    }

    function displayError(elementOrId, errorData) {
        const element = (typeof elementOrId === 'string') ? document.getElementById(elementOrId) : elementOrId;
        if (!element) return;

        let errorMessage = "Произошла ошибка.";
        if (errorData && errorData.detail) {
            if (typeof errorData.detail === 'string') {
                errorMessage = errorData.detail;
            } else if (Array.isArray(errorData.detail)) {
                errorMessage = errorData.detail.map(err => `${err.loc ? err.loc.join(' -> ') + ': ' : ''}${err.msg}`).join('<br>');
            } else if (typeof errorData.detail === 'object') {
                errorMessage = "Неизвестная ошибка при обработке данных.";
            }
        } else if (errorData && errorData.message) {
            errorMessage = errorData.message;
        }
        displayAlert(element, `<strong>Ошибка!</strong> ${errorMessage}`, 'danger', true, true);
    }

    async function fetchAPI(url, method = 'GET', body = null, isFile = false) {
        const headers = {};
        if (!isFile && body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
            headers['Content-Type'] = 'application/json';
        }

        const options = { method, headers };
        if (body && method !== 'GET' && method !== 'HEAD') {
            options.body = (isFile || typeof body === 'string' || body instanceof FormData) ? body : JSON.stringify(body);
        }

        const response = await fetch(url, options);
        let data = {};
        const contentType = response.headers.get("content-type");

        if (response.status === 204) {
            return { ok: response.ok, status: response.status, data: { message: "Операция успешно завершена (нет контента)." } };
        }

        try {
            if (contentType && contentType.includes("application/json")) {
                data = await response.json();
            } else {
                const textResponse = await response.text();
                try { data = JSON.parse(textResponse); } catch (e) {
                    data = { detail: textResponse || (response.ok ? "Успех (нет контента)" : "Ошибка (нет контента)") };
                }
            }
        } catch (e) {
            data = { detail: `Ошибка парсинга ответа сервера. Статус: ${response.status}` };
        }

        return { ok: response.ok, status: response.status, data };
    }

    const addDormForm = document.getElementById('addDormitoryForm');
    const addDormResultDiv = document.getElementById('addDormitoryResult');
    const defineStructureForm = document.getElementById('defineStructureForm');
    const defineStructureResultDiv = document.getElementById('defineStructureResult');
    const structureDormIdSelect = document.getElementById('structureDormId');
    const roomsContainer = document.getElementById('roomsContainer');
    const addRoomFieldBtn = document.getElementById('addRoomField');
    const loadDormsForSelectBtn = document.getElementById('loadDormsForStructure');
    const currentDormsListDiv = document.getElementById('currentDormitoriesList');
    const refreshDormListBtn = document.getElementById('refreshDormListBtn');

    const exportBtn = document.getElementById('exportStructureBtn');
    const downloadLink = document.getElementById('downloadLink');
    const importForm = document.getElementById('importStructureForm');
    const importResultDiv = document.getElementById('importResult');
    const exportResultDiv = document.getElementById('exportResult');

    const viewAppsBtn = document.getElementById('viewApplicationsBtn');
    const appsTableBody = document.getElementById('applicationsTableBody');
    const processAppsBtn = document.getElementById('processApplicationsBtn');
    const processAppsResultDiv = document.getElementById('processResult');
    const updateAppStatusForm = document.getElementById('updateStatusForm');
    const updateAppStatusResultDiv = document.getElementById('updateStatusResult');

    const allocateModalEl = document.getElementById('allocateRoomModal');
    let allocateModal;
    if (allocateModalEl) {
        allocateModal = new bootstrap.Modal(allocateModalEl);
    }
    const allocateModalTitle = document.getElementById('allocateModalLabel');
    const availableRoomsList = document.getElementById('availableRoomsList');
    const allocateRoomBtn = document.getElementById('confirmAllocateRoomBtn');
    const allocateRoomResultDiv = document.getElementById('allocateRoomResult');
    let currentApplicationIdForAllocation = null;

    const dormDetailsModalEl = document.getElementById('dormDetailsModal');
    let dormDetailsModal;
    if (dormDetailsModalEl) {
        dormDetailsModal = new bootstrap.Modal(dormDetailsModalEl);
    }
    const dormDetailsModalTitle = document.getElementById('dormDetailsModalLabel');
    const dormDetailsContent = document.getElementById('dormDetailsContent');

    let roomFieldIndex = 0;

    async function loadDormitoriesForSelect() {
        if (!structureDormIdSelect) return;
        structureDormIdSelect.innerHTML = '<option value="">-- Загрузка... --</option>';
        const { ok, data } = await fetchAPI('/staff/dormitories/');
        if (ok && Array.isArray(data)) {
            structureDormIdSelect.innerHTML = '<option value="">-- Выберите общежитие --</option>';
            data.forEach(dorm => {
                const option = new Option(dorm.name, dorm.id);
                structureDormIdSelect.add(option);
            });
        } else {
            structureDormIdSelect.innerHTML = '<option value="">-- Ошибка загрузки --</option>';
            displayError(defineStructureResultDiv, data.detail ? data : { detail: "Не удалось загрузить список общежитий для выбора." });
        }
    }

    function getOccupancyClass(current, capacity) {
        if (capacity === 0) return 'text-muted';
        const ratio = current / capacity;
        if (ratio >= 1) return 'room-occupancy-full';
        if (ratio >= 0.75) return 'room-occupancy-high';
        if (ratio >= 0.5) return 'room-occupancy-medium';
        return 'room-occupancy-low';
    }

    async function handleDeleteDormitory(dormitoryId, dormName) {
        if (!confirm(`Вы уверены, что хотите удалить общежитие "${dormName}"?\nЭто действие необратимо и удалит все комнаты в нем, а также может затронуть заселенных студентов (если не было проверки на сервере).\n\nУбедитесь, что общежитие пусто или студенты перераспределены!`)) {
            return;
        }
        displayAlert(addDormResultDiv, `Удаление общежития "${dormName}"...`, 'info', false);

        const { ok, status, data } = await fetchAPI(`/staff/dormitories/${dormitoryId}/`, 'DELETE');

        if (ok && (status === 204 || status === 200) ) {
            displayAlert(addDormResultDiv, data.message || `Общежитие "${dormName}" успешно удалено.`, 'success', true, true);
            loadAndDisplayDormitories();
            loadDormitoriesForSelect();
        } else {
            displayError(addDormResultDiv, data.detail ? data : { detail: `Ошибка при удалении общежития "${dormName}". Статус: ${status}` });
        }
    }

    async function showDormitoryDetails(dormitoryId) {
        if (!dormDetailsModal || !dormDetailsModalTitle || !dormDetailsContent) {
            console.error("Dorm details modal elements not found!");
            return;
        }
        dormDetailsModalTitle.textContent = 'Загрузка деталей общежития...';
        dormDetailsContent.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Загрузка...</span></div></div>';
        if (dormDetailsModal) dormDetailsModal.show();

        const { ok, data } = await fetchAPI(`/staff/dormitories/${dormitoryId}/details/`);
        if (ok && data) {
            dormDetailsModalTitle.textContent = `Детали общежития: ${data.name || 'Без названия'}`;
            let detailsHtml = `
            <p><strong>Название:</strong> ${data.name || 'Без названия'}</p>
            <p><strong>Адрес:</strong> ${data.address || 'Не указан'}</p>
            <h5>Комнаты:</h5>
        `;
            if (data.rooms && data.rooms.length > 0) {
                detailsHtml += '<div class="accordion" id="roomsAccordion">';
                data.rooms.forEach((room) => {
                    const collapseId = `roomCollapse${room.id || Math.random().toString(36).substring(7)}`;

                    const capacity = parseInt(room.capacity) || 0;
                    const currentOccupancy = parseInt(room.current_occupancy) || 0;
                    const roomNumber = room.room_number || 'N/A';
                    const floorNumber = room.floor_number !== undefined && room.floor_number !== null ? room.floor_number : 'N/A';

                    const occupantsHtml = room.occupants && room.occupants.length > 0 ?
                        `<ul class="list-group list-group-flush small mt-2">
                        ${room.occupants.map(o => {
                            const lastName = o.last_name || '';
                            const firstName = o.first_name || '';
                            const middleName = o.middle_name || '';
                            const studentId = o.student_ticket_number ? `(${o.student_ticket_number})` : '';
                            return `<li class="list-group-item py-1 px-2">
                                ${lastName} ${firstName} ${middleName} ${studentId}
                            </li>`;
                        }).join('')}
                    </ul>` :
                        '<p class="text-muted small"><em>Никто не заселен.</em></p>';

                    let badgeBgClass = 'bg-success';
                    if (capacity > 0 && currentOccupancy >= capacity) {
                        badgeBgClass = 'bg-danger';
                    } else if (capacity === 0) {
                        badgeBgClass = 'bg-secondary';
                    }

                    detailsHtml += `
                    <div class="accordion-item">
                        <h2 class="accordion-header" id="heading${room.id || Math.random().toString(36).substring(7)}">
                            <button class="accordion-button collapsed py-2" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
                                Комната ${roomNumber}, Этаж ${floorNumber}
                                <span class="ms-auto badge ${badgeBgClass}">
                                    ${currentOccupancy}/${capacity}
                                </span>
                            </button>
                        </h2>
                        <div id="${collapseId}" class="accordion-collapse collapse" aria-labelledby="heading${room.id || Math.random().toString(36).substring(7)}" data-bs-parent="#roomsAccordion">
                            <div class="accordion-body py-2">
                                <h6>Заселенные:</h6>
                                ${occupantsHtml}
                            </div>
                        </div>
                    </div>
                `;
                });
                detailsHtml += '</div>';
            } else {
                detailsHtml += '<p class="text-muted">Комнаты не определены для этого общежития.</p>';
            }
            dormDetailsContent.innerHTML = detailsHtml;
        } else {
            dormDetailsModalTitle.textContent = `Ошибка загрузки деталей`;
            let errorMsg = 'Не удалось загрузить детали общежития.';
            if (data && data.detail) {
                errorMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
            }
            dormDetailsContent.innerHTML = `<div class="alert alert-danger">${errorMsg}</div>`;
        }
    }

    async function loadAndDisplayDormitories() {
        if (!currentDormsListDiv) return;
        currentDormsListDiv.innerHTML = '<div class="col"><div class="alert alert-info">Загрузка списка общежитий...</div></div>';
        const { ok, data } = await fetchAPI('/staff/dormitories/');
        if (ok && Array.isArray(data)) {
            if (data.length === 0) {
                currentDormsListDiv.innerHTML = '<div class="col"><div class="alert alert-secondary">Общежития еще не добавлены.</div></div>';
                return;
            }
            currentDormsListDiv.innerHTML = '';
            data.forEach(dorm => {
                let totalCapacity = 0;
                let totalOccupancy = 0;
                let roomsHtml = '<p class="card-text small text-muted"><em>Комнаты не определены.</em></p>';
                if (dorm.rooms && dorm.rooms.length > 0) {
                    roomsHtml = '<ul class="list-group list-group-flush small">';
                    dorm.rooms.forEach(room => {
                        totalCapacity += room.capacity;
                        totalOccupancy += room.current_occupancy;
                        const occupancyClass = getOccupancyClass(room.current_occupancy, room.capacity);
                        roomsHtml += `<li class="list-group-item d-flex justify-content-between align-items-center py-1 px-2">
                                    <span>Этаж: ${room.floor_number}, комната: ${room.room_number}</span>
                                    <span class="badge ${room.current_occupancy === room.capacity ? 'bg-danger' : 'bg-success'} rounded-pill ${occupancyClass}">
                                        ${room.current_occupancy} / ${room.capacity}
                                    </span>
                                  </li>`;
                    });
                    roomsHtml += '</ul>';
                }

                const overallOccupancyPercent = totalCapacity > 0 ? Math.round((totalOccupancy / totalCapacity) * 100) : 0;
                let progressBarClass = 'bg-success';
                if (overallOccupancyPercent >= 100) progressBarClass = 'bg-danger';
                else if (overallOccupancyPercent >= 75) progressBarClass = 'bg-warning text-dark';

                const cardHtml = `
                <div class="col">
                    <div class="card h-100 shadow-sm card-dormitory">
                        <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
                            <span><i class="bi bi-building"></i> ${dorm.name}</span>
                            <button class="btn btn-sm btn-outline-primary view-dorm-details-btn" data-dorm-id="${dorm.id}" title="Показать детали общежития">
                                <i class="bi bi-info-circle-fill"></i> Детали
                            </button>
                        </div>
                        <div class="card-body py-2 px-3">
                            <p class="card-text small mb-1"><i class="bi bi-geo-alt-fill"></i> <strong>Адрес:</strong> ${dorm.address || 'Не указан'}</p>
                            <p class="card-text small mb-1"><strong>Загруженность:</strong> ${totalOccupancy} из ${totalCapacity} мест</p>
                            <div class="progress" role="progressbar" aria-label="Загруженность общежития" aria-valuenow="${overallOccupancyPercent}" aria-valuemin="0" aria-valuemax="100" style="height: 20px; position: relative;">
                                <div class="progress-bar ${progressBarClass}" style="width: ${overallOccupancyPercent}%"></div>
                                <span class="progress-bar-text text-white">${overallOccupancyPercent}%</span>
                            </div>
                            <div class="mt-2">
                                <h6 class="card-subtitle my-1 text-muted small">Комнаты:</h6>
                                <div style="max-height: 120px; overflow-y: auto; border: 1px solid #eee; padding: 5px; border-radius: .25rem;">
                                    ${roomsHtml}
                                </div>
                            </div>
                        </div>
                        <div class="card-footer bg-transparent border-top-0 pt-0 pb-2 text-end">
                            <button class="btn btn-sm btn-outline-danger delete-dorm-btn" data-dorm-id="${dorm.id}" data-dorm-name="${dorm.name}" title="Удалить общежитие">
                                <i class="bi bi-trash-fill"></i> Удалить
                            </button>
                        </div>
                    </div>
                </div>`;
                currentDormsListDiv.insertAdjacentHTML('beforeend', cardHtml);
            });

            document.querySelectorAll('#currentDormitoriesList .delete-dorm-btn').forEach(button => {
                button.addEventListener('click', function() {
                    const dormId = this.dataset.dormId;
                    const dormName = this.dataset.dormName;
                    handleDeleteDormitory(dormId, dormName);
                });
            });

            document.querySelectorAll('.view-dorm-details-btn').forEach(button => {
                button.addEventListener('click', function() {
                    const dormId = this.dataset.dormId;
                    showDormitoryDetails(dormId);
                });
            });

        } else {
            currentDormsListDiv.innerHTML = `<div class="col"><div class="alert alert-danger">Ошибка загрузки общежитий: ${data.detail || 'Неизвестная ошибка'}</div></div>`;
        }
    }

    if (addDormForm) {
        addDormForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const name = document.getElementById('dormName').value;
            const address = document.getElementById('dormAddress').value;
            const { ok, data } = await fetchAPI('/staff/dormitories/', 'POST', { name, address });
            if (ok) {
                displayAlert(addDormResultDiv, `Общежитие "<strong>${data.name}</strong>" успешно добавлено!`, 'success', true, true);
                addDormForm.reset();
                loadDormitoriesForSelect();
                loadAndDisplayDormitories();
            } else {
                displayError(addDormResultDiv, data);
            }
        });
    }

    if (loadDormsForSelectBtn) {
        loadDormsForSelectBtn.addEventListener('click', loadDormitoriesForSelect);
    }
    if (refreshDormListBtn) {
        refreshDormListBtn.addEventListener('click', loadAndDisplayDormitories);
    }

    if (addRoomFieldBtn) {
        addRoomFieldBtn.addEventListener('click', function() {
            roomFieldIndex++;
            const roomDiv = document.createElement('div');
            roomDiv.classList.add('room-field-group', 'mb-2', 'p-2', 'border', 'rounded', 'bg-white');
            roomDiv.innerHTML = `
            <div class="row g-2 align-items-center">
                <div class="col-auto"><span class="fw-bold small">Комн. ${roomFieldIndex}:</span></div>
                <div class="col">
                    <input type="number" class="form-control form-control-sm room-floor" placeholder="Этаж" required min="0">
                </div>
                <div class="col">
                    <input type="text" class="form-control form-control-sm room-number-val" placeholder="Номер" required>
                </div>
                <div class="col">
                    <input type="number" class="form-control form-control-sm room-capacity" placeholder="Мест" required min="1">
                </div>
                <div class="col-auto">
                    <button type="button" class="btn btn-sm btn-outline-danger remove-room-btn"><i class="bi bi-trash"></i></button>
                </div>
            </div>`;
            if (roomsContainer) roomsContainer.appendChild(roomDiv);
            roomDiv.querySelector('.remove-room-btn').addEventListener('click', () => roomDiv.remove());
        });
    }

    if (defineStructureForm) {
        defineStructureForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const dormitoryId = structureDormIdSelect.value;
            if (!dormitoryId) {
                displayAlert(defineStructureResultDiv, 'Пожалуйста, выберите общежитие.', 'warning');
                return;
            }
            const rooms = [];
            let formIsValid = true;
            document.querySelectorAll('#roomsContainer .room-field-group').forEach(group => {
                const floorInput = group.querySelector('.room-floor');
                const roomNumberInput = group.querySelector('.room-number-val');
                const capacityInput = group.querySelector('.room-capacity');
                if (floorInput.value && roomNumberInput.value && capacityInput.value) {
                    const capacity = parseInt(capacityInput.value);
                    const floor = parseInt(floorInput.value);
                    if (capacity < 1) {
                        displayAlert(defineStructureResultDiv, 'Количество мест в комнате не может быть меньше 1.', 'warning');
                        capacityInput.focus();
                        formIsValid = false;
                        return;
                    }
                    if (floor < 0) {
                        displayAlert(defineStructureResultDiv, 'Номер этажа не может быть отрицательным.', 'warning');
                        floorInput.focus();
                        formIsValid = false;
                        return;
                    }
                    rooms.push({
                        floor_number: floor,
                        room_number: roomNumberInput.value,
                        capacity: capacity
                    });
                } else {
                    displayAlert(defineStructureResultDiv, 'Все поля для каждой комнаты должны быть заполнены.', 'warning');
                    formIsValid = false;
                    return;
                }
            });

            if (!formIsValid) return;
            if (rooms.length === 0) {
                displayAlert(defineStructureResultDiv, 'Добавьте хотя бы одну комнату для определения структуры.', 'warning');
                return;
            }

            const { ok, data } = await fetchAPI(`/staff/dormitories/${dormitoryId}/structure/`, 'POST', rooms);
            if (ok) {
                displayAlert(defineStructureResultDiv, `Структура для общежития успешно обновлена.`, 'success');
                if(roomsContainer) roomsContainer.innerHTML = '';
                roomFieldIndex = 0;
                loadAndDisplayDormitories();
            } else {
                displayError(defineStructureResultDiv, data);
            }
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', async function() {
            const { ok, data } = await fetchAPI('/staff/dormitories/structure/export/');
            if (ok) {
                const jsonData = JSON.stringify(data, null, 2);
                const blob = new Blob([jsonData], { type: 'application/json' });
                if (downloadLink) {
                    downloadLink.href = URL.createObjectURL(blob);
                    downloadLink.download = `dormitories_structure_${new Date().toISOString().slice(0, 10)}.json`;
                    downloadLink.click();
                    URL.revokeObjectURL(downloadLink.href);
                }
                displayAlert(exportResultDiv, "Структура успешно экспортирована.", 'success');
            } else {
                displayError(exportResultDiv, data);
            }
        });
    }

    if (importForm) {
        importForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const fileInput = document.getElementById('importFile');
            if (fileInput.files.length === 0) {
                displayAlert(importResultDiv, 'Пожалуйста, выберите файл для импорта.', 'warning');
                return;
            }
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);

            const { ok, data } = await fetchAPI('/staff/dormitories/structure/import/', 'POST', formData, true);
            if (ok) {
                displayAlert(importResultDiv, data.message || 'Структура успешно импортирована.', 'success');
                fileInput.value = '';
                loadDormitoriesForSelect();
                loadAndDisplayDormitories();
            } else {
                displayError(importResultDiv, data);
            }
        });
    }

    function getStatusTextAndClass(status) {
        let text = status;
        let className = '';
        switch (status.toLowerCase()) {
            case 'pending':
                text = 'Принято';
                className = 'status-pending';
                break;
            case 'approved':
                text = 'Одобрено';
                className = 'status-approved';
                break;
            case 'rejected':
                text = 'Отклонено';
                className = 'status-rejected';
                break;
            case 'allocated':
                text = 'Заселен';
                className = 'status-allocated';
                break;
        }
        return { text, className };
    }

    async function loadApplications() {
        if (!appsTableBody) return;
        appsTableBody.innerHTML = '<tr><td colspan="7" class="text-center"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Загрузка...</span></div> Загрузка заявлений...</td></tr>';
        const { ok, data } = await fetchAPI('/staff/applications/');
        if (ok && Array.isArray(data)) {
            if (data.length === 0) {
                appsTableBody.innerHTML = '<tr><td colspan="7" class="text-center">Поданных заявлений нет.</td></tr>';
                return;
            }
            appsTableBody.innerHTML = '';
            data.sort((a, b) => a.id - b.id);

            data.forEach(app => {
                let studentName = "N/A";
                let studentIdNum = "N/A";
                if (app.student_info) {
                    studentName = `${app.student_info.last_name || ''} ${app.student_info.first_name || ''} ${app.student_info.middle_name || ''}`.trim();
                    studentIdNum = app.student_info.student_ticket_number || "N/A";
                }
                const appDate = new Date(app.application_date).toLocaleDateString('ru-RU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

                let allocationInfo = '-';
                let changeAllocationBtn = '';
                if (app.status.toLowerCase() === 'allocated') {
                    if (app.allocated_dorm_name && app.allocated_floor_number !== undefined && app.allocated_room_number !== undefined) {
                        allocationInfo = `${app.allocated_dorm_name}, эт.${app.allocated_floor_number}, к.${app.allocated_room_number}`;
                    } else {
                        allocationInfo = `Комната не определена`;
                    }
                    changeAllocationBtn = `<button class="btn btn-sm btn-outline-info ms-2 change-allocation-btn" data-app-id="${app.id}" title="Изменить место заселения">
                                        <i class="bi bi-pencil-square"></i> Изменить
                                    </button>`;
                }

                const { text: statusText, className: statusClassName } = getStatusTextAndClass(app.status);

                const row = appsTableBody.insertRow();
                row.innerHTML = `
                <td>${app.id}</td>
                <td>${studentName}</td>
                <td>${studentIdNum}</td>
                <td>${appDate}</td>
                <td class="${statusClassName}">${statusText}</td>
                <td>${allocationInfo} ${changeAllocationBtn}</td>
                <td>${app.rejection_reason || '-'}</td>
            `;
            });

            document.querySelectorAll('.change-allocation-btn').forEach(button => {
                button.addEventListener('click', function() {
                    currentApplicationIdForAllocation = this.dataset.appId;
                    if (allocateModalTitle) allocateModalTitle.textContent = `Изменить место заселения студента с номером заявления: ${currentApplicationIdForAllocation}`;
                    loadAvailableRooms();
                    if (allocateModal) allocateModal.show();
                });
            });

        } else {
            appsTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Ошибка загрузки заявлений: ${data.detail || 'Неизвестная ошибка'}</td></tr>`;
        }
    }

    async function loadAvailableRooms() {
        if (!availableRoomsList || !allocateRoomResultDiv) return;
        availableRoomsList.innerHTML = '<div class="alert alert-info py-2">Загрузка доступных комнат...</div>';
        allocateRoomResultDiv.innerHTML = '';
        const { ok, data } = await fetchAPI('/staff/applications/available_rooms/');
        if (ok && Array.isArray(data)) {
            if (data.length === 0) {
                availableRoomsList.innerHTML = '<div class="alert alert-warning py-2">Нет свободных комнат для заселения.</div>';
                if (allocateRoomBtn) allocateRoomBtn.disabled = true;
                return;
            }
            availableRoomsList.innerHTML = '';
            if (allocateRoomBtn) allocateRoomBtn.disabled = false;

            const roomsByDorm = {};
            data.forEach(room => {
                const dormKey = room.dormitory_id;

                const dormDisplayName = room.dormitory_name || `Общежитие`;
                const dormDisplayAddress = room.dormitory_address || 'Адрес не указан';

                if (!roomsByDorm[dormKey]) {
                    roomsByDorm[dormKey] = {
                        name: dormDisplayName,
                        address: dormDisplayAddress,
                        rooms: []
                    };
                }
                roomsByDorm[dormKey].rooms.push(room);
            });

            for (const dormKey in roomsByDorm) {
                const dormInfo = roomsByDorm[dormKey];
                const addressPart = dormInfo.address && dormInfo.address !== 'Адрес не указан' ? ` (${dormInfo.address})` : '';

                let dormHtml = `<div class="card card-body mb-2 py-2">
                                <h6 class="mb-2">${dormInfo.name}${addressPart}</h6>
                                <div class="list-group list-group-flush">`;
                dormInfo.rooms.forEach(room => {
                    dormHtml += `<label class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                                <input class="form-check-input me-2" type="radio" name="selectedRoom" value="${room.id}" id="room${room.id}">
                                Комната: ${room.room_number}, Этаж: ${room.floor_number}
                                <span class="badge bg-success rounded-pill">${room.current_occupancy}/${room.capacity}</span>
                            </label>`;
                });
                dormHtml += `</div></div>`;
                availableRoomsList.insertAdjacentHTML('beforeend', dormHtml);
            }

        } else {
            availableRoomsList.innerHTML = `<div class="alert alert-danger py-2">Ошибка загрузки комнат: ${data.detail || 'Неизвестная ошибка'}</div>`;
            if (allocateRoomBtn) allocateRoomBtn.disabled = true;
        }
    }

    if (allocateRoomBtn) {
        allocateRoomBtn.addEventListener('click', async function() {
            const selectedRoomRadio = document.querySelector('input[name="selectedRoom"]:checked');
            if (!selectedRoomRadio) {
                displayAlert(allocateRoomResultDiv, 'Пожалуйста, выберите комнату.', 'warning');
                return;
            }
            const roomId = parseInt(selectedRoomRadio.value);

            displayAlert(allocateRoomResultDiv, 'Обновление места заселения...', 'info', false);

            const { ok, data } = await fetchAPI(`/staff/applications/${currentApplicationIdForAllocation}/allocate/`, 'PUT', { room_id: roomId });

            if (ok) {
                displayAlert(allocateRoomResultDiv, `Место заселения для заявления ID <strong>${data.id}</strong> успешно изменено.`, 'success', true, true);
                if (allocateModal) setTimeout(() => allocateModal.hide(), 2000);
                loadApplications();
                loadAndDisplayDormitories();
            } else {
                displayError(allocateRoomResultDiv, data);
            }
        });
    }

    if (viewAppsBtn) {
        viewAppsBtn.addEventListener('click', loadApplications);
    }

    if (processAppsBtn) {
        processAppsBtn.addEventListener('click', async function() {
            displayAlert(processAppsResultDiv, 'Запуск автоматической проверки возможности заселения...', 'info', false);
            const { ok, data } = await fetchAPI('/staff/applications/process_auto/', 'POST');
            if (ok) {
                displayAlert(processAppsResultDiv, `Проверка завершена: <strong>${data.message}</strong>`, 'success', true, true);
                loadApplications();
                loadAndDisplayDormitories();
            } else {
                displayError(processAppsResultDiv, data);
            }
        });
    }

    if (updateAppStatusForm) {
        updateAppStatusForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const applicationId = document.getElementById('appIdUpdate').value;
            const newStatus = document.getElementById('newStatus').value;
            const rejectionReason = document.getElementById('rejectionReason').value.trim();

            if (!applicationId) {
                displayAlert(updateAppStatusResultDiv, 'Пожалуйста, введите ID заявления.', 'warning');
                return;
            }
            const payload = { status: newStatus };
            if (newStatus.toLowerCase() === 'rejected' && rejectionReason) {
                payload.rejection_reason = rejectionReason;
            } else if (newStatus.toLowerCase() === 'rejected' && !rejectionReason) {
                displayAlert(updateAppStatusResultDiv, 'Пожалуйста, укажите причину отклонения.', 'warning');
                return;
            }

            const { ok, data } = await fetchAPI(`/staff/applications/${applicationId}/status/`, 'PUT', payload);
            if (ok) {
                const { text: updatedStatusText } = getStatusTextAndClass(data.status);
                displayAlert(updateAppStatusResultDiv, `Статус заявления ID <strong>${data.id}</strong> успешно обновлен на "<strong>${updatedStatusText}</strong>".`, 'success', true, true);
                updateAppStatusForm.reset();
                loadApplications();
                if (data.status.toLowerCase() === 'allocated' || (data.old_status_was_allocated && data.status.toLowerCase() !== 'allocated')) {
                    loadAndDisplayDormitories();
                }
            } else {
                displayError(updateAppStatusResultDiv, data);
            }
        });
    }

    const initialActiveTab = document.querySelector('#staffTab .nav-link.active');
    if (initialActiveTab) {
        const targetPaneId = initialActiveTab.getAttribute('data-bs-target');
        if (targetPaneId === '#dorms-tab-pane') {
            loadAndDisplayDormitories();
            loadDormitoriesForSelect();
        } else if (targetPaneId === '#applications-tab-pane') {
            loadApplications();
        }
    }
    document.querySelectorAll('#staffTab button[data-bs-toggle="tab"]').forEach(tabEl => {
        tabEl.addEventListener('shown.bs.tab', event => {
            const targetPaneId = event.target.getAttribute('data-bs-target');
            if (targetPaneId === '#dorms-tab-pane') {
                loadAndDisplayDormitories();
                loadDormitoriesForSelect();
            } else if (targetPaneId === '#applications-tab-pane') {
                loadApplications();
            }
        });
    });

});