document.addEventListener('DOMContentLoaded', function() {
    const applyForm = document.getElementById('applyForm');
    const applyResultDiv = document.getElementById('applyResult');
    const statusForm = document.getElementById('statusForm');
    const statusResultDiv = document.getElementById('statusResult');

    function displayAlert(element, message, type = 'info', isHtml = false) {
        let content = message;
        if (!isHtml && typeof message === 'object') {
             content = `<strong>Ошибка!</strong> ${message.detail || 'Неизвестная ошибка.'}`;
             type = 'danger';
        } else if (!isHtml) {
            content = message;
        }

        element.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
                                ${content}
                                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                             </div>`;
    }

    function displayError(element, errorData) {
        let errorMessage = "Произошла ошибка.";
        if (errorData && errorData.detail) {
            if (typeof errorData.detail === 'string') {
                errorMessage = errorData.detail;
            } else if (Array.isArray(errorData.detail) && errorData.detail.length > 0) {
                errorMessage = errorData.detail.map(err => `${err.loc ? err.loc.join(' -> ') + ': ' : ''}${err.msg}`).join('<br>');
            } else if (typeof errorData.detail === 'object') {
                errorMessage = JSON.stringify(errorData.detail);
            }
        } else if (errorData && errorData.message) {
            errorMessage = errorData.message;
        }
        displayAlert(element, `<strong>Ошибка!</strong> ${errorMessage}`, 'danger', true);
    }


    if (applyForm) {
        applyForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const studentLastName = document.getElementById('studentLastNameApply').value;
            const studentTicketNumber = document.getElementById('studentTicketNumberApply').value;
            applyResultDiv.innerHTML = '<div class="alert alert-info">Отправка данных...</div>';

            try {
                const response = await fetch('/student/applications/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        last_name: studentLastName,
                        student_ticket_number: studentTicketNumber
                    })
                });
                const data = await response.json();
                if (response.ok) {
                    displayAlert(applyResultDiv, `Ваше заявление успешно зарегистрировано! <strong>Номер заявления: ${data.id}.</strong>`, 'success', true);
                    applyForm.reset();
                } else {
                    displayError(applyResultDiv, data);
                }
            } catch (error) {
                displayError(applyResultDiv, { message: `Сетевая ошибка: ${error.message}` });
            }
        });
    }

    if (statusForm) {
        statusForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const studentLastName = document.getElementById('studentLastNameStatus').value;
            const studentTicketNumber = document.getElementById('studentTicketNumberStatus').value;
            statusResultDiv.innerHTML = '<div class="alert alert-info">Запрос статуса...</div>';

            try {
                const response = await fetch('/student/applications/status_by_details/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        last_name: studentLastName,
                        student_ticket_number: studentTicketNumber
                    })
                });
                const data = await response.json();

                if (response.ok) {
                    let studentFullName = `${data.student_last_name} ${data.student_first_name}`;
                    if (data.student_middle_name) {
                        studentFullName += ` ${data.student_middle_name}`;
                    }

                    let statusText = data.status;
                    switch (data.status.toLowerCase()) {
                        case 'pending': statusText = 'Принято'; break;
                        case 'approved': statusText = 'Одобрено'; break;
                        case 'rejected': statusText = 'Отклонено'; break;
                        case 'allocated': statusText = 'Заселен'; break;
                    }

                    let resultHtml = `<p class="mb-1"><strong>Номер заявления:</strong> ${data.application_id}</p>
                                      <p class="mb-1"><strong>Студент:</strong> ${studentFullName} (номер студенческого билета: ${data.student_ticket_number})</p>
                                      <p class="mb-1"><strong>Статус:</strong> <span class="badge bg-${getBootstrapStatusClass(data.status)}">${statusText}</span></p>`;

                    if (data.rejection_reason) {
                        resultHtml += `<p class="mb-1"><strong>Причина/Комментарий:</strong> ${data.rejection_reason}</p>`;
                    }

                    if (data.status.toLowerCase() === 'allocated' && data.dormitory_name) {
                        resultHtml += `<p class="mb-0"><strong>Место заселения:</strong> ${data.dormitory_name} (${data.dormitory_address || 'адрес не указан'}), этаж ${data.floor_number}, комната ${data.room_number}</p>`;
                    }
                    displayAlert(statusResultDiv, resultHtml, 'light', true);
                } else {
                    displayError(statusResultDiv, data);
                }
            } catch (error) {
                displayError(statusResultDiv, { message: `Сетевая ошибка: ${error.message}` });
            }
        });
    }

    function getBootstrapStatusClass(status) {
        switch (status.toLowerCase()) {
            case 'pending': return 'warning text-dark';
            case 'approved': return 'success';
            case 'allocated': return 'info text-dark';
            case 'rejected': return 'danger';
            default: return 'secondary';
        }
    }
});