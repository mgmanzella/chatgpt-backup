function generateOffsets(startOffset, total) {
  const interval = 20;
  const start = startOffset + interval;
  const offsets = [];

  for (let i = start; i <= total; i += interval) {
    offsets.push(i);
  }

  return offsets;
}

function sleep(ms = 1000) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

function parseConversation(rawConversation) {
  const title = rawConversation.title;
  const create_time = rawConversation.create_time;
  const mapping = rawConversation.mapping;
  const keys = Object.keys(mapping);
  const messages = [];

  for (const k of keys) {
    const msgPayload = mapping[k];
    const msg = msgPayload.message;
    if (!msg) continue;

    const role = msg.author.role;
    const content = msg.content.parts;
    const model = msg.metadata.model_slug;
    const create_time = msg.create_time;

    messages.push({
      role,
      content,
      model,
      create_time,
    });
  }

  return {
    messages,
    create_time,
    title,
  };
}

function getRequestCount(total, startOffset, stopOffset) {
  if (stopOffset === -1) return total;

  return stopOffset - startOffset;
}

function logProgress(total, messages, offset) {
  const progress = Math.round((messages / total) * 100);
  console.log(`GPT-BACKUP::PROGRESS::${progress}%::OFFSET::${offset}`);
}

function getDateFormat(date) {
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  const hours = ('0' + date.getHours()).slice(-2);
  const minutes = ('0' + date.getMinutes()).slice(-2);
  const seconds = ('0' + date.getSeconds()).slice(-2);

  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

function downloadJson(data) {
  const jsonString = JSON.stringify(data, null, 2);
  const jsonBlob = new Blob([jsonString], { type: 'application/json' });
  const downloadLink = document.createElement('a');
  downloadLink.href = URL.createObjectURL(jsonBlob);
  downloadLink.download = `gpt-backup-${getDateFormat(new Date())}.json`;
  document.body.appendChild(downloadLink);
  downloadLink.click();

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(downloadLink.href);
      resolve();
    }, 150);
  });
}

function downloadJsonWithName(data, filename) {
  const jsonString = JSON.stringify(data, null, 2);
  const jsonBlob = new Blob([jsonString], { type: 'application/json' });
  const downloadLink = document.createElement('a');
  downloadLink.href = URL.createObjectURL(jsonBlob);
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();

  return new Promise((resolve) => {
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(downloadLink.href);
      resolve();
    }, 150);
  });
}

function saveCheckpoint(checkpoint) {
  const key = 'gpt_backup_checkpoint_v1';
  try {
    localStorage.setItem(key, JSON.stringify(checkpoint));
  } catch (error) {
    const fallbackCheckpoint = {
      saved_at: checkpoint.saved_at,
      start_offset: checkpoint.start_offset,
      stop_offset: checkpoint.stop_offset,
      processed: checkpoint.processed,
      total_listed: checkpoint.total_listed,
      success_count: Array.isArray(checkpoint.conversations)
        ? checkpoint.conversations.length
        : checkpoint.success_count || 0,
      failed_count: Array.isArray(checkpoint.failed)
        ? checkpoint.failed.length
        : checkpoint.failed_count || 0,
      last_failed: Array.isArray(checkpoint.failed)
        ? checkpoint.failed.slice(-20)
        : [],
      note: 'lightweight checkpoint due to storage quota',
    };

    try {
      localStorage.removeItem(key);
      localStorage.setItem(key, JSON.stringify(fallbackCheckpoint));
      console.warn(
        'GPT-BACKUP::CHECKPOINT::LIGHTWEIGHT::REASON::STORAGE_QUOTA',
      );
    } catch (fallbackError) {
      console.warn(
        'GPT-BACKUP::CHECKPOINT::SKIPPED::REASON::STORAGE_QUOTA',
        fallbackError,
      );
    }
  }
}

function logConfig(startOffset, stopOffset) {
  console.log('GPT-BACKUP::CONFIG::START_OFFSET::' + startOffset);
  console.log('GPT-BACKUP::CONFIG::STOP_OFFSET::' + stopOffset);
  console.log('GPT-BACKUP::CONFIG::HOST::chatgpt.com');
}

async function loadToken() {
  const res = await fetch('https://chatgpt.com/api/auth/session');

  if (!res.ok) {
    throw new Error('failed to fetch token');
  }

  const json = await res.json();
  return json.accessToken;
}

async function getConversationIds(token, offset = 0) {
  console.log(`GPT-BACKUP::IDS::REQUEST::OFFSET::${offset}::LIMIT::20`);
  const res = await fetch(
    `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=20`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (!res.ok) {
    throw new Error('failed to fetch conversation ids');
  }

  const json = await res.json();
  const items = Array.isArray(json.items) ? json.items : [];
  const firstId = items[0] && items[0].id ? items[0].id : 'none';
  const lastId =
    items.length > 0 && items[items.length - 1].id
      ? items[items.length - 1].id
      : 'none';
  console.log(
    `GPT-BACKUP::IDS::RESPONSE::OFFSET::${offset}::ITEMS::${items.length}::TOTAL::${json.total}::FIRST_ID::${firstId}::LAST_ID::${lastId}`,
  );
  return {
    items: items.map((item) => ({ ...item, offset })),
    total: json.total,
  };
}

async function fetchConversation(token, id, maxAttempts = 3, attempt = 1) {
  const INITIAL_BACKOFF = 10000;
  const BACKOFF_MULTIPLIER = 2;
  try {
    console.log(
      `GPT-BACKUP::CONVO::REQUEST::ID::${id}::ATTEMPT::${attempt}/${maxAttempts}`,
    );
    const res = await fetch(
      `https://chatgpt.com/backend-api/conversation/${id}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );
    
    if (!res.ok) {
      throw new Error(`Unsuccessful response (${res.status})`);
    }

    console.log(`GPT-BACKUP::CONVO::SUCCESS::ID::${id}::STATUS::${res.status}`);
    return res.json();

  } catch (error) {
    if (attempt >= maxAttempts) {
      throw new Error(`Failed to fetch conversation after ${maxAttempts} attempts.`);
    } else {
      var backoff = INITIAL_BACKOFF * Math.pow(BACKOFF_MULTIPLIER, attempt);
      console.log(`Error. Retrying in ${backoff}ms.`);
      await sleep(backoff);
      return fetchConversation(token, id, maxAttempts, attempt + 1);
    }
  }
}

async function getAllConversations(startOffset, stopOffset) {
  logConfig(startOffset, stopOffset);
  const token = await loadToken();
  console.log(
    `GPT-BACKUP::AUTH::TOKEN::LOADED::PREFIX::${String(token).slice(0, 10)}...`,
  );

  let reportedTotal = 0;
  let reportedTotalFirstPage = 0;
  const allItems = [];
  const seenIds = new Set();
  const pageLimit = 20;
  const maxPages = 1000;
  let page = 0;
  let currentOffset = startOffset;
  let lastOffset = startOffset;

  // Keep paginating until the API returns no more items (or duplicates only),
  // instead of trusting the reported total which may be capped.
  while (page < maxPages) {
    if (stopOffset !== -1 && currentOffset >= stopOffset) {
      console.log(
        `GPT-BACKUP::IDS::STOP_REACHED::OFFSET::${currentOffset}::STOP_OFFSET::${stopOffset}`,
      );
      break;
    }

    const { total, items } = await getConversationIds(token, currentOffset);
    if (page === 0) {
      reportedTotalFirstPage = total;
      console.log(
        `GPT-BACKUP::IDS::FIRST_BATCH::OFFSET::${currentOffset}::COUNT::${items.length}::TOTAL::${total}`,
      );
    }
    reportedTotal = total;
    page += 1;

    if (!items.length) {
      console.log(
        `GPT-BACKUP::IDS::PAGINATION_END::REASON::EMPTY_PAGE::OFFSET::${currentOffset}::PAGE::${page}`,
      );
      break;
    }

    let newItemsInPage = 0;
    for (const item of items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push(item);
        newItemsInPage += 1;
      }
    }

    console.log(
      `GPT-BACKUP::IDS::PAGE::${page}::OFFSET::${currentOffset}::REPORTED_TOTAL::${total}::ITEMS::${items.length}::NEW_ITEMS::${newItemsInPage}::AGGREGATE_UNIQUE::${allItems.length}`,
    );

    if (newItemsInPage === 0) {
      console.log(
        `GPT-BACKUP::IDS::PAGINATION_END::REASON::NO_NEW_IDS::OFFSET::${currentOffset}::PAGE::${page}`,
      );
      break;
    }

    lastOffset = currentOffset;
    if (items.length < pageLimit) {
      console.log(
        `GPT-BACKUP::IDS::PAGINATION_END::REASON::SHORT_PAGE::OFFSET::${currentOffset}::ITEMS::${items.length}`,
      );
      break;
    }

    currentOffset += pageLimit;
    await sleep();
  }

  if (page === maxPages) {
    console.warn(`GPT-BACKUP::IDS::PAGINATION_END::REASON::MAX_PAGES::${maxPages}`);
  }

  console.log(
    `GPT-BACKUP::IDS::SUMMARY::REPORTED_TOTAL_FIRST_PAGE::${reportedTotalFirstPage}::REPORTED_TOTAL_LAST_PAGE::${reportedTotal}::UNIQUE_IDS::${allItems.length}`,
  );

  const allConversations = [];
  const failedConversations = [];
  const requested =
    stopOffset === -1
      ? allItems.length
      : getRequestCount(reportedTotalFirstPage, startOffset, stopOffset);

  console.log(`GPT-BACKUP::STARTING::TOTAL-OFFSETS::${lastOffset}`);
  console.log(`GPT-BACKUP::STARTING::REQUESTED-MESSAGES::${requested}`);
  console.log(`GPT-BACKUP::STARTING::TOTAL-MESSAGES::${reportedTotal}`);
  for (let index = 0; index < allItems.length; index++) {
    const item = allItems[index];
    // 60 conversations/min
    await sleep(1000);

    // log progress
    if (allConversations.length % 20 === 0) {
      logProgress(requested, allConversations.length, item.offset);
    }

    try {
      const rawConversation = await fetchConversation(token, item.id);
      const conversation = parseConversation(rawConversation);
      allConversations.push(conversation);
      if ((index + 1) % 10 === 0 || index === allItems.length - 1) {
        console.log(
          `GPT-BACKUP::CONVO::COUNTS::PROCESSED::${index + 1}/${allItems.length}::SUCCESS::${allConversations.length}::FAILED::${failedConversations.length}`,
        );
      }
    } catch (error) {
      failedConversations.push({
        id: item.id,
        offset: item.offset,
        error: String(error && error.message ? error.message : error),
      });
      console.error(
        `GPT-BACKUP::FAILED::ID::${item.id}::OFFSET::${item.offset}`,
        error,
      );
    }

    if ((index + 1) % 20 === 0 || index === allItems.length - 1) {
      saveCheckpoint({
        saved_at: new Date().toISOString(),
        start_offset: startOffset,
        stop_offset: stopOffset,
        processed: index + 1,
        total_listed: allItems.length,
        success_count: allConversations.length,
        failed: failedConversations,
      });
      console.log(
        `GPT-BACKUP::CHECKPOINT::PROCESSED::${index + 1}::SUCCESS::${allConversations.length}::FAILED::${failedConversations.length}`,
      );
    }
  }

  logProgress(requested, allConversations.length, lastOffset);

  return {
    conversations: allConversations,
    failedConversations,
    requested,
    listed: allItems.length,
  };
}

async function main(startOffset, stopOffset) {
  const {
    conversations,
    failedConversations,
    requested,
    listed,
  } = await getAllConversations(startOffset, stopOffset);
  await downloadJson(conversations);

  if (failedConversations.length > 0) {
    await downloadJsonWithName(
      {
        generated_at: new Date().toISOString(),
        requested,
        listed,
        success_count: conversations.length,
        failed_count: failedConversations.length,
        failed: failedConversations,
      },
      `gpt-backup-failed-${getDateFormat(new Date())}.json`,
    );
  }

  console.log(
    `GPT-BACKUP::SUMMARY::REQUESTED::${requested}::LISTED::${listed}::SUCCESS::${conversations.length}::FAILED::${failedConversations.length}`,
  );
}

// customize if you need to continue from a previous run
// increments of 20
const START_OFFSET = 0;
// set to -1 to run through all messages
const STOP_OFFSET = -1;

main(START_OFFSET, STOP_OFFSET)
  .then(() => console.log('GPT-BACKUP::DONE'))
  .catch((e) => console.error(e));
