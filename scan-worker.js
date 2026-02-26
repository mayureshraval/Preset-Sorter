const { parentPort, workerData } = require("worker_threads");
const sorter = require("./sorter");

(async () => {
  const result = await sorter.previewSort(workerData.folder);
  parentPort.postMessage(result);
})();