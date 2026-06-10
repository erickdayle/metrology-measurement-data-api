const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiFetch(endpoint, options = {}, retries = 5) {
  const BASE_URL = process.env.URL;
  const TOKEN = process.env.TOKEN;
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { ...options, headers });

      if (!response.ok) {
        const errorText = await response.text();

        if ((response.status >= 500 || response.status === 429) && i < retries - 1) {
          let waitTime = (i + 1) * 2000;

          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            if (retryAfter) waitTime = parseInt(retryAfter) * 1000;
            console.warn(`Rate limit hit (429). Pausing for ${waitTime / 1000}s...`);
          } else {
            console.warn(`API server error (${response.status}). Retrying in ${waitTime / 1000}s...`);
          }

          await delay(waitTime);
          continue;
        }

        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      if (
        (error.cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
          error.cause?.code === "UND_ERR_SOCKET") &&
        i < retries - 1
      ) {
        console.warn(`Network timeout. Retrying in ${i + 1}s...`);
        await delay((i + 1) * 1000);
        continue;
      }
      throw error;
    }
  }
}

export const getRecordMetadata = async (recordId) => {
  const response = await apiFetch(`/records/${recordId}/meta`);
  return response.data;
};

export const postTableRows = async (recordId, fieldId, rows) => {
  return apiFetch(`/records/${recordId}/table/${fieldId}`, {
    method: "POST",
    body: JSON.stringify({ type: "table", table: rows }),
  });
};
