// functions/api.js
const crypto = require('crypto');

// ============ Конфигурация ============
// Установите эти переменные в Netlify Dashboard (Site Settings > Environment Variables)
const CONFIG = {
    // Пароль доступа к приложению
    ACCESS_PASSWORD: process.env.ACCESS_PASSWORD || 'admin123',
    
    // Yandex GPT
    YANDEX_FOLDER_ID: process.env.YANDEX_FOLDER_ID || '',
    YANDEX_API_KEY: process.env.YANDEX_API_KEY || '',
    YANDEX_GPT_URL: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
    YANDEX_MODEL: 'yandexgpt-5-lite',
    
    // PlantUML
    PLANTUML_URL: 'https://www.plantuml.com/plantuml',
    
    // Сессия
    SESSION_SECRET: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    SESSION_MAX_AGE: 3600 * 24, // 24 часа
};

// ============ Утилиты для сессий ============
// В Netlify Functions для хранения сессий используем простой Map
// Внимание: при перезапуске функции сессии сбрасываются!
// Для продакшена используйте Redis или другую базу данных.
const sessions = new Map();

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function createSession() {
    const sessionId = generateSessionId();
    const sessionData = {
        authenticated: false,
        createdAt: Date.now(),
    };
    sessions.set(sessionId, sessionData);
    return sessionId;
}

function getSession(sessionId) {
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;
    
    // Проверка истечения срока
    if (Date.now() - session.createdAt > CONFIG.SESSION_MAX_AGE * 1000) {
        sessions.delete(sessionId);
        return null;
    }
    return session;
}

function updateSession(sessionId, data) {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (session) {
        Object.assign(session, data);
        sessions.set(sessionId, session);
    }
}

function deleteSession(sessionId) {
    if (sessionId) {
        sessions.delete(sessionId);
    }
}

// ============ PlantUML кодирование ============
// Алфавит PlantUML
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodePlantUML(plantumlCode) {
    let code = plantumlCode.trim();
    if (!code.startsWith('@startuml')) {
        code = `@startuml\n${code}\n@enduml`;
    }
    
    // Сжатие deflate
    const deflated = deflate(code);
    
    // Преобразование в base64 с алфавитом PlantUML
    const base64 = Buffer.from(deflated).toString('base64');
    return base64.replace(/[A-Za-z0-9+/]/g, (match) => {
        const idx = BASE64_ALPHABET.indexOf(match);
        return idx !== -1 ? PLANTUML_ALPHABET[idx] : match;
    });
}

// Простая реализация deflate для Node.js
function deflate(data) {
    const zlib = require('zlib');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    return compressed;
}

function generatePlantUMLUrl(plantumlCode) {
    const encoded = encodePlantUML(plantumlCode);
    return `${CONFIG.PLANTUML_URL}/png/${encoded}`;
}

// ============ Yandex GPT Client ============
async function generatePlantUML(description) {
    const { YANDEX_FOLDER_ID, YANDEX_API_KEY, YANDEX_GPT_URL, YANDEX_MODEL } = CONFIG;
    
    if (!YANDEX_FOLDER_ID || !YANDEX_API_KEY) {
        throw new Error('Yandex GPT credentials not configured');
    }
    
    const prompt = `Ты — эксперт по PlantUML. Создай корректный код на PlantUML для UML sequence-диаграммы на основе следующего описания:

ОПИСАНИЕ USE CASE:
${description}

ТРЕБОВАНИЯ К ДИАГРАММЕ:
1. Используй синтаксис PlantUML для sequence-диаграмм
2. Покажи всех участников взаимодействия:
   - Пользователи (actor)
   - Веб-приложения (participant)
   - Backend сервисы (participant)
   - Базы данных (database)
   - Брокеры сообщений (queue)
   - Внешние системы (participant)

3. Правила создания диаграммы:
   - Все участники должны быть объявлены в начале диаграммы
   - Используй бары активации (activate/deactivate) для всех компонентов
   - При self-вызове создавай вложенный бар активации
   - Для запросов используй стрелки ->
   - Для ответов используй пунктирные стрелки -->
   - Подписывай стрелки действиями и методами API

4. Пример корректного синтаксиса:
@startuml
actor "Пользователь" as User
participant "Веб-приложение" as Web
participant "Backend" as Backend
database "База данных" as DB

User -> Web: Отправить запрос
activate Web

Web -> Backend: POST /api/process
activate Backend

Backend -> DB: SELECT * FROM users
activate DB
DB --> Backend: Данные пользователя
deactivate DB

Backend -> Backend: Валидация данных
activate Backend
deactivate Backend

Backend --> Web: Ответ с данными
deactivate Backend

Web --> User: Отобразить результат
deactivate Web
@enduml

ВАЖНЫЕ ПРАВИЛА:
- Каждый activate должен иметь соответствующий deactivate
- Не используй символы '```' в ответе
- Не добавляй пояснения вне кода
- Код должен начинаться с @startuml и заканчиваться @enduml
- Убедись, что все стрелки имеют текстовые подписи
- Используй описательные имена для участников

Сгенерируй только PlantUML код, без дополнительного текста.`;

    const payload = {
        modelUri: `gpt://${YANDEX_FOLDER_ID}/${YANDEX_MODEL}`,
        completionOptions: {
            stream: false,
            temperature: 0.2,
            maxTokens: 2000,
        },
        messages: [
            { role: 'user', text: prompt }
        ],
    };
    
    const headers = {
        'Authorization': `Api-Key ${YANDEX_API_KEY}`,
        'x-folder-id': YANDEX_FOLDER_ID,
        'Content-Type': 'application/json',
    };
    
    try {
        const response = await fetch(YANDEX_GPT_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Yandex GPT API error: ${response.status} ${errorText}`);
        }
        
        const data = await response.json();
        
        if (data.result && data.result.alternatives && data.result.alternatives.length > 0) {
            let code = data.result.alternatives[0].message.text;
            
            // Очистка кода от маркеров markdown
            code = code.trim();
            if (code.startsWith('```plantuml') || code.startsWith('```')) {
                const lines = code.split('\n');
                if (lines.length > 2) {
                    code = lines.slice(1, -1).join('\n');
                }
            }
            code = code.replace(/```/g, '').trim();
            
            return code;
        }
        
        throw new Error('Не удалось получить ответ от Yandex GPT');
        
    } catch (error) {
        console.error('Yandex GPT error:', error);
        throw error;
    }
}

// ============ Netlify Function Handler ============
exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
    
    // OPTIONS запрос
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }
    
    // Получение или создание сессии
    let sessionId = event.headers.cookie?.match(/sessionId=([^;]+)/)?.[1];
    let session = null;
    
    if (sessionId) {
        session = getSession(sessionId);
    }
    
    if (!session) {
        sessionId = createSession();
        session = getSession(sessionId);
        // Устанавливаем cookie
        headers['Set-Cookie'] = `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=${CONFIG.SESSION_MAX_AGE}`;
    }
    
    const action = event.queryStringParameters?.action || '';
    const body = event.body ? JSON.parse(event.body) : {};
    
    try {
        // ============ Проверка авторизации ============
        if (action === 'check') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ authenticated: session?.authenticated || false }),
            };
        }
        
        // ============ Логин ============
        if (action === 'login') {
            const { password } = body;
            
            if (password === CONFIG.ACCESS_PASSWORD) {
                updateSession(sessionId, { authenticated: true });
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ success: true, message: 'Вход выполнен успешно' }),
                };
            } else {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ success: false, error: 'Неверный код доступа' }),
                };
            }
        }
        
        // ============ Логаут ============
        if (action === 'logout') {
            deleteSession(sessionId);
            headers['Set-Cookie'] = `sessionId=; HttpOnly; Path=/; Max-Age=0`;
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true }),
            };
        }
        
        // ============ Проверка авторизации для остальных действий ============
        if (!session?.authenticated) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Требуется авторизация' }),
            };
        }
        
        // ============ Генерация диаграммы ============
        if (action === 'generate') {
            const { description } = body;
            
            if (!description || !description.trim()) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Описание не может быть пустым' }),
                };
            }
            
            try {
                const plantumlCode = await generatePlantUML(description.trim());
                const imageUrl = generatePlantUMLUrl(plantumlCode);
                
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        plantuml_code: plantumlCode,
                        image_url: imageUrl,
                    }),
                };
            } catch (error) {
                console.error('Generation error:', error);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: error.message || 'Ошибка генерации' }),
                };
            }
        }
        
        // ============ Рендеринг диаграммы ============
        if (action === 'render') {
            const { code } = body;
            
            if (!code || !code.trim()) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Код диаграммы обязателен' }),
                };
            }
            
            try {
                const imageUrl = generatePlantUMLUrl(code.trim());
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ image_url: imageUrl }),
                };
            } catch (error) {
                console.error('Render error:', error);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: error.message || 'Ошибка рендеринга' }),
                };
            }
        }
        
        // ============ Неизвестное действие ============
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Неизвестное действие' }),
        };
        
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Внутренняя ошибка сервера' }),
        };
    }
};