using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace PdvLocalAgent
{
    public class Program
    {
        private static readonly string Version = "1.1.3";
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
        private static AgentConfig Config;
        private static Logger Log;
        private static BlockingCollection<PrintJob> Queue;
        private static ConcurrentDictionary<string, PrintJob> Jobs = new ConcurrentDictionary<string, PrintJob>();
        private static Thread Worker;
        private static HttpListener Listener;
        private static CodePageInfo CodePage;
        private static bool UpdateInProgress;

        public static void Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string configPath = Path.Combine(baseDir, "agent-config.json");
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--config" && i + 1 < args.Length)
                {
                    configPath = args[i + 1];
                    i++;
                }
            }

            Config = AgentConfig.Load(configPath);
            Log = new Logger(baseDir);
            CodePage = CodePageInfo.Resolve(Config.codePage);
            Serializer.MaxJsonLength = Math.Max(Config.maxBodyBytes, 1024 * 1024);

            Queue = new BlockingCollection<PrintJob>(new ConcurrentQueue<PrintJob>(), Config.queueMax);
            Worker = new Thread(ProcessQueue) { IsBackground = true };
            Worker.Start();

            Console.CancelKeyPress += (sender, eventArgs) =>
            {
                eventArgs.Cancel = true;
                Stop();
            };

            StartHttpServer();
        }

        private static void StartHttpServer()
        {
            string prefix = string.Format("http://{0}:{1}/", Config.host, Config.port);
            Listener = new HttpListener();
            Listener.Prefixes.Add(prefix);
            Listener.Start();
            Log.Info("PDV local agent running at " + prefix);

            while (Listener.IsListening)
            {
                try
                {
                    var context = Listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => HandleRequest(context));
                }
                catch (HttpListenerException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Log.Error("Listener error: " + ex);
                }
            }
        }

        private static void Stop()
        {
            try
            {
                if (Listener != null)
                {
                    Listener.Stop();
                }
            }
            catch
            {
            }

            try
            {
                if (Queue != null)
                {
                    Queue.CompleteAdding();
                }
            }
            catch
            {
            }

            Log.Info("Agent stopped.");
        }

        private static void HandleRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;
            try
            {
                AddCorsHeaders(response);
                if (request.HttpMethod == "OPTIONS")
                {
                    response.StatusCode = 204;
                    response.Close();
                    return;
                }

                var path = request.Url.AbsolutePath ?? "/";
                if (request.HttpMethod == "GET" && path == "/health")
                {
                    SendJson(response, 200, new
                    {
                        ok = true,
                        version = Version,
                        queue = new
                        {
                            pending = Queue.Count,
                            processing = FindCurrentJobId()
                        }
                    });
                    return;
                }

                if (request.HttpMethod == "GET" && path == "/printers")
                {
                    var printers = new List<string>();
                    foreach (string printer in PrinterSettings.InstalledPrinters)
                    {
                        printers.Add(printer);
                    }
                    SendJson(response, 200, new { ok = true, printers = printers });
                    return;
                }

                if (request.HttpMethod == "GET" && path.StartsWith("/jobs/", StringComparison.OrdinalIgnoreCase))
                {
                    var jobId = path.Substring("/jobs/".Length).Trim();
                    if (string.IsNullOrWhiteSpace(jobId))
                    {
                        SendJson(response, 400, new { ok = false, error = "job-id-required" });
                        return;
                    }
                    PrintJob job;
                    if (Jobs.TryGetValue(jobId, out job))
                    {
                        SendJson(response, 200, new { ok = true, job = job.ToResponse() });
                        return;
                    }
                    SendJson(response, 404, new { ok = false, error = "job-not-found" });
                    return;
                }

                if (request.HttpMethod == "GET" && path == "/queue")
                {
                    var items = new List<object>();
                    foreach (var entry in Jobs.Values)
                    {
                        items.Add(entry.ToResponse());
                    }
                    SendJson(response, 200, new { ok = true, jobs = items });
                    return;
                }
                if (request.HttpMethod == "POST" && path == "/print-json")
                {
                    var body = ReadBody(request, Config.maxBodyBytes);
                    var payload = Serializer.Deserialize<PrintRequest>(body);
                    if (payload == null || payload.document == null)
                    {
                        SendJson(response, 400, new { ok = false, error = "invalid-payload" });
                        return;
                    }

                    string printerName = ResolvePrinterName(payload.printerName);
                    if (string.IsNullOrWhiteSpace(printerName))
                    {
                        SendJson(response, 400, new { ok = false, error = "printer-not-found" });
                        return;
                    }

                    int copies = NormalizeCopies(payload.copies);
                    payload.document.paperWidth = NormalizePaperWidth(payload.document.paperWidth);
                    if (string.IsNullOrWhiteSpace(payload.document.paperWidth))
                    {
                        payload.document.paperWidth = NormalizePaperWidth(Config.paperWidth);
                    }

                    var job = new PrintJob
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        Name = string.IsNullOrWhiteSpace(payload.jobName)
                            ? (payload.document.title ?? "Documento")
                            : payload.jobName,
                        PrinterName = printerName,
                        Copies = copies,
                        Document = payload.document,
                        CreatedAt = DateTime.UtcNow,
                        Status = "queued"
                    };

                    if (!Queue.TryAdd(job))
                    {
                        SendJson(response, 429, new { ok = false, error = "queue-full" });
                        return;
                    }

                    Jobs[job.Id] = job;
                    SendJson(response, 200, new { ok = true, queued = true, jobId = job.Id });
                    return;
                }

                if (request.HttpMethod == "POST" && path == "/update")
                {
                    if (!IsLocalRequest(request))
                    {
                        SendJson(response, 403, new { ok = false, error = "forbidden" });
                        return;
                    }

                    if (UpdateInProgress)
                    {
                        SendJson(response, 409, new { ok = false, error = "update-in-progress" });
                        return;
                    }

                    if (Queue.Count > 0 || !string.IsNullOrWhiteSpace(FindCurrentJobId()))
                    {
                        SendJson(response, 409, new { ok = false, error = "queue-busy" });
                        return;
                    }

                    var body = ReadBody(request, Config.maxBodyBytes);
                    var payload = Serializer.Deserialize<UpdateRequest>(body);
                    if (payload == null || string.IsNullOrWhiteSpace(payload.downloadUrl))
                    {
                        SendJson(response, 400, new { ok = false, error = "download-url-required" });
                        return;
                    }

                    if (!StartUpdateProcess(payload.downloadUrl))
                    {
                        SendJson(response, 500, new { ok = false, error = "update-failed" });
                        return;
                    }

                    UpdateInProgress = true;
                    SendJson(response, 200, new { ok = true, updating = true });
                    return;
                }

                if (request.HttpMethod == "POST" && path == "/print")
                {
                    SendJson(response, 400, new { ok = false, error = "not-supported" });
                    return;
                }

                SendJson(response, 404, new { ok = false, error = "not-found" });
            }
            catch (InvalidOperationException ex)
            {
                SendJson(response, 400, new { ok = false, error = ex.Message });
            }
            catch (Exception ex)
            {
                Log.Error("Request error: " + ex);
                try
                {
                    SendJson(response, 500, new { ok = false, error = "server-error" });
                }
                catch
                {
                }
            }
            finally
            {
                try
                {
                    response.Close();
                }
                catch
                {
                }
            }
        }
        private static void ProcessQueue()
        {
            foreach (var job in Queue.GetConsumingEnumerable())
            {
                job.Status = "printing";
                job.StartedAt = DateTime.UtcNow;
                Jobs[job.Id] = job;
                var stopwatch = Stopwatch.StartNew();
                Log.Info(string.Format("[print] started id={0} name={1} printer=\"{2}\" copies={3}", job.Id, job.Name, job.PrinterName, job.Copies));

                try
                {
                    ExecuteJob(job);
                    job.Status = "done";
                    job.Error = string.Empty;
                    Log.Info(string.Format("[print] done id={0} name={1} ({2}ms)", job.Id, job.Name, stopwatch.ElapsedMilliseconds));
                }
                catch (TimeoutException ex)
                {
                    job.Status = "timeout";
                    job.Error = ex.Message;
                    Log.Error(string.Format("[print] timeout id={0} name={1} ({2}ms)", job.Id, job.Name, stopwatch.ElapsedMilliseconds));
                    Log.Error(ex.ToString());
                }
                catch (Exception ex)
                {
                    job.Status = "error";
                    job.Error = ex.Message;
                    Log.Error(string.Format("[print] error id={0} name={1} ({2}ms)", job.Id, job.Name, stopwatch.ElapsedMilliseconds));
                    Log.Error(ex.ToString());
                }
                finally
                {
                    stopwatch.Stop();
                    job.CompletedAt = DateTime.UtcNow;
                    Jobs[job.Id] = job;
                }
            }
        }

        private static void ExecuteJob(PrintJob job)
        {
            if (job == null || job.Document == null)
            {
                throw new InvalidOperationException("document-empty");
            }

            int timeoutMs = Config.printWaitMs;
            Exception error = null;
            var thread = new Thread(() =>
            {
                try
                {
                    PrintDocumentRaw(job);
                }
                catch (Exception ex)
                {
                    error = ex;
                }
            }) { IsBackground = true };
            thread.Start();

            if (timeoutMs > 0)
            {
                if (!thread.Join(timeoutMs))
                {
                    throw new TimeoutException("print-timeout");
                }
            }
            else
            {
                thread.Join();
            }

            if (error != null)
            {
                throw error;
            }
        }

        private static void PrintDocumentRaw(PrintJob job)
        {
            var renderer = new ReceiptRenderer(job.Document.paperWidth, CodePage);
            byte[] bytes = renderer.Render(job.Document);
            for (int i = 0; i < job.Copies; i++)
            {
                if (!RawPrinterHelper.SendBytesToPrinter(job.PrinterName, bytes))
                {
                    throw new InvalidOperationException("print-failed");
                }
            }
        }

        private static string ResolvePrinterName(string requestedName)
        {
            string name = string.IsNullOrWhiteSpace(requestedName) ? string.Empty : requestedName.Trim();
            if (!string.IsNullOrWhiteSpace(name) && Config.printerAliases != null)
            {
                string alias;
                if (Config.printerAliases.TryGetValue(name, out alias))
                {
                    name = alias;
                }
            }

            if (string.IsNullOrWhiteSpace(name))
            {
                name = string.IsNullOrWhiteSpace(Config.defaultPrinter) ? new PrinterSettings().PrinterName : Config.defaultPrinter;
            }

            if (string.IsNullOrWhiteSpace(name))
            {
                return null;
            }

            foreach (string printer in PrinterSettings.InstalledPrinters)
            {
                if (string.Equals(printer, name, StringComparison.OrdinalIgnoreCase))
                {
                    return printer;
                }
            }

            return null;
        }

        private static int NormalizeCopies(int copies)
        {
            if (copies <= 0)
            {
                copies = 1;
            }
            if (Config.maxCopies > 0)
            {
                copies = Math.Min(copies, Config.maxCopies);
            }
            return copies;
        }

        private static string NormalizePaperWidth(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }
            var normalized = value.Trim().ToLowerInvariant();
            if (normalized == "80" || normalized == "80mm")
            {
                return "80mm";
            }
            if (normalized == "58" || normalized == "58mm")
            {
                return "58mm";
            }
            return string.Empty;
        }

        private static string FindCurrentJobId()
        {
            foreach (var entry in Jobs.Values)
            {
                if (entry.Status == "printing")
                {
                    return entry.Id;
                }
            }
            return string.Empty;
        }

        private static string ReadBody(HttpListenerRequest request, int maxBytes)
        {
            if (request == null)
            {
                throw new InvalidOperationException("invalid-request");
            }

            if (request.ContentLength64 > maxBytes)
            {
                throw new InvalidOperationException("payload-too-large");
            }

            using (var stream = request.InputStream)
            using (var ms = new MemoryStream())
            {
                var buffer = new byte[8192];
                int read;
                int total = 0;
                while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    total += read;
                    if (total > maxBytes)
                    {
                        throw new InvalidOperationException("payload-too-large");
                    }
                    ms.Write(buffer, 0, read);
                }
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        private static bool IsLocalRequest(HttpListenerRequest request)
        {
            try
            {
                var endpoint = request != null ? request.RemoteEndPoint : null;
                if (endpoint == null)
                {
                    return false;
                }
                return IPAddress.IsLoopback(endpoint.Address);
            }
            catch
            {
                return false;
            }
        }

        private static string QuoteArg(string value)
        {
            if (value == null)
            {
                return "\"\"";
            }
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static bool StartUpdateProcess(string downloadUrl)
        {
            if (string.IsNullOrWhiteSpace(downloadUrl))
            {
                return false;
            }
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string startBat = Path.Combine(baseDir, "start-agent.bat");
                string scriptPath = Path.Combine(
                    Path.GetTempPath(),
                    "pdv-local-agent-update-" + Guid.NewGuid().ToString("N") + ".ps1"
                );
                string script = @"param(
  [string]$downloadUrl,
  [string]$agentDir,
  [int]$pid,
  [string]$startBat
)
$ErrorActionPreference = 'Stop'
try {
  $tempDir = Join-Path $env:TEMP ('pdv-local-agent-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $zipPath = Join-Path $tempDir 'agent.zip'
  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
  Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
  if ($pid -gt 0) { try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {} }
  Start-Sleep -Milliseconds 700
  Get-ChildItem -Path $tempDir | Where-Object { $_.Name -ne 'agent.zip' } | ForEach-Object {
    $target = Join-Path $agentDir $_.Name
    if ($_.PSIsContainer) {
      Copy-Item $_.FullName -Destination $target -Recurse -Force
    } else {
      Copy-Item $_.FullName -Destination $target -Force
    }
  }
  if ($startBat -and (Test-Path $startBat)) {
    Start-Process -FilePath $startBat -ArgumentList '--hidden' -WorkingDirectory $agentDir
  }
} catch {
}
";
                File.WriteAllText(scriptPath, script, Encoding.UTF8);
                int pid = Process.GetCurrentProcess().Id;
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments =
                        "-NoProfile -ExecutionPolicy Bypass -File " + QuoteArg(scriptPath) +
                        " -downloadUrl " + QuoteArg(downloadUrl) +
                        " -agentDir " + QuoteArg(baseDir) +
                        " -pid " + pid +
                        " -startBat " + QuoteArg(startBat),
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static void AddCorsHeaders(HttpListenerResponse response)
        {
            response.Headers["Access-Control-Allow-Origin"] = "*";
            response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
        }

        private static void SendJson(HttpListenerResponse response, int statusCode, object data)
        {
            string json = Serializer.Serialize(data);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            response.StatusCode = statusCode;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
        }
    }
    public class AgentConfig
    {
        public string host { get; set; }
        public int port { get; set; }
        public int printWaitMs { get; set; }
        public int queueMax { get; set; }
        public int maxCopies { get; set; }
        public int maxBodyBytes { get; set; }
        public string defaultPrinter { get; set; }
        public string codePage { get; set; }
        public string paperWidth { get; set; }
        public Dictionary<string, string> printerAliases { get; set; }

        public static AgentConfig Load(string path)
        {
            var config = new AgentConfig
            {
                host = "127.0.0.1",
                port = 17305,
                printWaitMs = 45000,
                queueMax = 50,
                maxCopies = 10,
                maxBodyBytes = 10485760,
                defaultPrinter = string.Empty,
                codePage = "cp860",
                paperWidth = "80mm",
                printerAliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            };

            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            {
                return config;
            }

            try
            {
                var json = File.ReadAllText(path, Encoding.UTF8);
                var serializer = new JavaScriptSerializer();
                var loaded = serializer.Deserialize<AgentConfig>(json) ?? new AgentConfig();
                if (!string.IsNullOrWhiteSpace(loaded.host))
                {
                    config.host = loaded.host.Trim();
                }
                if (loaded.port > 0)
                {
                    config.port = loaded.port;
                }
                if (loaded.queueMax > 0)
                {
                    config.queueMax = Math.Min(200, Math.Max(1, loaded.queueMax));
                }
                if (loaded.maxCopies > 0)
                {
                    config.maxCopies = Math.Min(10, Math.Max(1, loaded.maxCopies));
                }
                if (loaded.maxBodyBytes > 0)
                {
                    config.maxBodyBytes = loaded.maxBodyBytes;
                }
                if (loaded.printWaitMs > 0)
                {
                    config.printWaitMs = Math.Min(120000, Math.Max(2000, loaded.printWaitMs));
                }
                if (!string.IsNullOrWhiteSpace(loaded.defaultPrinter))
                {
                    config.defaultPrinter = loaded.defaultPrinter.Trim();
                }
                if (!string.IsNullOrWhiteSpace(loaded.codePage))
                {
                    config.codePage = loaded.codePage.Trim();
                }
                if (!string.IsNullOrWhiteSpace(loaded.paperWidth))
                {
                    config.paperWidth = loaded.paperWidth.Trim();
                }
                if (loaded.printerAliases != null)
                {
                    foreach (var entry in loaded.printerAliases)
                    {
                        if (string.IsNullOrWhiteSpace(entry.Key) || string.IsNullOrWhiteSpace(entry.Value))
                        {
                            continue;
                        }
                        config.printerAliases[entry.Key.Trim()] = entry.Value.Trim();
                    }
                }
            }
            catch
            {
                return config;
            }

            return config;
        }
    }

    public class PrintRequest
    {
        public string printerName { get; set; }
        public int copies { get; set; }
        public string jobName { get; set; }
        public ReceiptDocument document { get; set; }
    }

    public class UpdateRequest
    {
        public string downloadUrl { get; set; }
    }

    public class ReceiptDocument
    {
        public int version { get; set; }
        public string type { get; set; }
        public string title { get; set; }
        public string variant { get; set; }
        public string paperWidth { get; set; }
        public int columns { get; set; }
        public string font { get; set; }
        public string printerType { get; set; }
        public LogoInfo logo { get; set; }
        public ReceiptMeta meta { get; set; }
        public List<ReceiptItem> items { get; set; }
        public ReceiptTotals totals { get; set; }
        public List<ReceiptPayment> payments { get; set; }
        public ReceiptCustomer customer { get; set; }
        public ReceiptDelivery delivery { get; set; }
        public ReceiptSummary summary { get; set; }
        public ReceiptSection recebimentos { get; set; }
        public ReceiptSection previsto { get; set; }
        public ReceiptSection apurado { get; set; }
        public ReceiptQrCode qrCode { get; set; }
        public ReceiptFooter footer { get; set; }
        public BudgetInfo budget { get; set; }
        public string fallbackText { get; set; }
    }

    public class LogoInfo
    {
        public bool enabled { get; set; }
        public string label { get; set; }
        public string image { get; set; }
    }

    public class ReceiptMeta
    {
        public string store { get; set; }
        public string pdv { get; set; }
        public string saleCode { get; set; }
        public string operatorName { get; set; }
        public string date { get; set; }
        public string openedAt { get; set; }
        public string closedAt { get; set; }
        public string budgetCode { get; set; }
        public string validUntil { get; set; }
        public string @operator { get; set; }
        public string fiscalNumber { get; set; }
        public string fiscalSerie { get; set; }
        public string accessKey { get; set; }
        public string protocol { get; set; }
        public string environment { get; set; }
        public string consultaUrl { get; set; }
    }

    public class ReceiptItem
    {
        public string index { get; set; }
        public string name { get; set; }
        public string code { get; set; }
        public string quantity { get; set; }
        public string unitPrice { get; set; }
        public string total { get; set; }
    }

    public class ReceiptTotals
    {
        public string subtotal { get; set; }
        public string discount { get; set; }
        public double discountValue { get; set; }
        public string addition { get; set; }
        public double additionValue { get; set; }
        public string total { get; set; }
        public string paid { get; set; }
        public string change { get; set; }
        public double changeValue { get; set; }
        public List<ReceiptPromotion> promotions { get; set; }
    }

    public class ReceiptPromotion
    {
        public string label { get; set; }
        public string value { get; set; }
        public double amount { get; set; }
    }

    public class ReceiptPayment
    {
        public string label { get; set; }
        public string value { get; set; }
        public double amount { get; set; }
    }

    public class ReceiptCustomer
    {
        public string name { get; set; }
        public string document { get; set; }
        public string contact { get; set; }
        public string celular { get; set; }
        public string telefone { get; set; }
        public string celular2 { get; set; }
        public string telefone2 { get; set; }
        public string address { get; set; }
        public string pet { get; set; }
    }

    public class ReceiptDelivery
    {
        public string label { get; set; }
        public string address { get; set; }
        public string cep { get; set; }
        public string logradouro { get; set; }
        public string numero { get; set; }
        public string complemento { get; set; }
        public string bairro { get; set; }
        public string cidade { get; set; }
        public string uf { get; set; }
    }

    public class ReceiptValue
    {
        public double value { get; set; }
        public string formatted { get; set; }
    }

    public class ReceiptSummary
    {
        public ReceiptValue abertura { get; set; }
        public ReceiptValue recebido { get; set; }
        public ReceiptValue recebimentosCliente { get; set; }
        public ReceiptValue saldo { get; set; }
    }

    public class ReceiptRow
    {
        public string label { get; set; }
        public string value { get; set; }
        public double amount { get; set; }
    }

    public class ReceiptSection
    {
        public List<ReceiptRow> items { get; set; }
        public double total { get; set; }
        public string formattedTotal { get; set; }
    }

    public class ReceiptQrCode
    {
        public string payload { get; set; }
        public string image { get; set; }
        public int moduleSize { get; set; }
        public string errorCorrection { get; set; }
    }

    public class ReceiptFooter
    {
        public List<string> lines { get; set; }
    }

    public class BudgetInfo
    {
        public string code { get; set; }
        public int validityDays { get; set; }
        public string validUntil { get; set; }
        public string status { get; set; }
    }

    public class PrintJob
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string PrinterName { get; set; }
        public int Copies { get; set; }
        public ReceiptDocument Document { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? StartedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public string Status { get; set; }
        public string Error { get; set; }

        public object ToResponse()
        {
            return new
            {
                id = Id,
                name = Name,
                printerName = PrinterName,
                copies = Copies,
                status = Status,
                createdAt = CreatedAt,
                startedAt = StartedAt,
                completedAt = CompletedAt,
                error = Error
            };
        }
    }
    public class ReceiptRenderer
    {
        private int Width;
        private int RightColumnWidth;
        private readonly Encoding Encoding;
        private readonly CodePageInfo CodePage;
        private readonly List<byte> Buffer = new List<byte>();
        private FontMode PreferredFont;

        private enum FontMode : byte { A = 0, B = 1 }

        private struct DanfeItemLayout
        {
            public int CodeWidth;
            public int DescWidth;
            public int QtyWidth;
            public int UnitWidth;
            public int UnitPriceWidth;
            public int TotalWidth;
        }

        public ReceiptRenderer(string paperWidth, CodePageInfo codePage)
        {
            ApplyPaperWidthDefaults(paperWidth);
            CodePage = codePage ?? CodePageInfo.Resolve("cp860");
            Encoding = Encoding.GetEncoding(CodePage.DotNetCodePage);
        }

        public byte[] Render(ReceiptDocument doc)
        {
            ApplyDocumentOverrides(doc);
            Initialize();
            if (doc == null)
            {
                AddLine("Documento vazio");
                return Finish();
            }

            var type = (doc.type ?? string.Empty).Trim().ToLowerInvariant();
            var variant = (doc.variant ?? string.Empty).Trim().ToLowerInvariant();
            if (type == "nfce" || type == "danfe" || variant.Contains("nfce") || variant.Contains("danfe"))
            {
                RenderDanfeNfce(doc, true);
                return Finish();
            }
            if (type == "venda" && (variant == "matricial" || variant.Contains("matricial")))
            {
                RenderDanfeNfce(doc, false);
                return Finish();
            }
            if (type == "fechamento")
            {
                RenderFechamento(doc);
            }
            else if (type == "orcamento")
            {
                RenderBudget(doc);
            }
            else
            {
                RenderSale(doc);
            }

            return Finish();
        }

        private void Initialize()
        {
            AppendBytes(new byte[] { 0x1B, 0x40 });
            AppendBytes(new byte[] { 0x1B, 0x74, (byte)CodePage.EscPosCode });
            SetAlign(TextAlign.Left);
            SetFont(PreferredFont);
        }

        private void ApplyPaperWidthDefaults(string paperWidth)
        {
            if (string.Equals(paperWidth, "58mm", StringComparison.OrdinalIgnoreCase))
            {
                Width = 42;
                PreferredFont = FontMode.B;
            }
            else
            {
                Width = 48;
                PreferredFont = FontMode.A;
            }
            RightColumnWidth = Width >= 48 ? 12 : 10;
        }

        private void ApplyDocumentOverrides(ReceiptDocument doc)
        {
            if (doc == null)
            {
                return;
            }

            if (doc.columns > 0)
            {
                int columns = Math.Max(32, Math.Min(80, doc.columns));
                Width = columns;
                if (Width >= 64)
                {
                    RightColumnWidth = 14;
                }
                else if (Width >= 48)
                {
                    RightColumnWidth = 12;
                }
                else
                {
                    RightColumnWidth = 10;
                }
                if (string.IsNullOrWhiteSpace(doc.font))
                {
                    PreferredFont = Width > 48 ? FontMode.B : (Width <= 42 ? FontMode.B : FontMode.A);
                }
            }

            if (!string.IsNullOrWhiteSpace(doc.font))
            {
                if (string.Equals(doc.font, "b", StringComparison.OrdinalIgnoreCase))
                {
                    PreferredFont = FontMode.B;
                }
                else if (string.Equals(doc.font, "a", StringComparison.OrdinalIgnoreCase))
                {
                    PreferredFont = FontMode.A;
                }
            }

            ApplyPrinterProfile(doc);
        }

        private void ApplyPrinterProfile(ReceiptDocument doc)
        {
            if (doc == null)
            {
                return;
            }

            string type = (doc.printerType ?? string.Empty).Trim().ToLowerInvariant();
            if (doc.qrCode == null)
            {
                return;
            }

            if (doc.qrCode.moduleSize <= 0)
            {
                if (type == "elgin")
                {
                    doc.qrCode.moduleSize = Width <= 42 ? 4 : 5;
                }
                else if (type == "bematech")
                {
                    doc.qrCode.moduleSize = Width <= 42 ? 3 : 4;
                }
            }

            if (string.IsNullOrWhiteSpace(doc.qrCode.errorCorrection))
            {
                if (type == "elgin")
                {
                    doc.qrCode.errorCorrection = "M";
                }
                else if (type == "bematech")
                {
                    doc.qrCode.errorCorrection = "L";
                }
            }
        }

        private byte[] Finish()
        {
            FeedLines(3);
            Cut();
            return Buffer.ToArray();
        }

        private void RenderSale(ReceiptDocument doc)
        {
            var meta = doc.meta;
            string storeName = meta != null ? meta.store : string.Empty;
            string title = doc.title ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(storeName))
            {
                AddLineCentered(storeName, true, 2, 2);
                if (!string.IsNullOrWhiteSpace(title))
                {
                    AddLineCentered(title.ToUpperInvariant(), true);
                }
            }
            else
            {
                AddLineCentered(title.ToUpperInvariant(), true, 2, 2);
            }
            PrintLogoLabel(doc.logo);
            AddSeparator('-');

            string pdv = meta != null ? meta.pdv : string.Empty;
            string saleCode = meta != null ? meta.saleCode : string.Empty;
            string operatorName = meta != null ? (meta.@operator ?? meta.operatorName) : string.Empty;
            string date = meta != null ? meta.date : string.Empty;
            PrintMetaPair("PDV", pdv, "Venda", saleCode);
            PrintMetaPair("Operador", operatorName, "Data", date);

            RenderSaleBody(doc);
        }

        private void RenderBudget(ReceiptDocument doc)
        {
            var meta = doc.meta;
            var budget = doc.budget;
            string storeName = meta != null ? meta.store : string.Empty;
            string title = doc.title ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(storeName))
            {
                AddLineCentered(storeName, true, 2, 2);
                if (!string.IsNullOrWhiteSpace(title))
                {
                    AddLineCentered(title.ToUpperInvariant(), true);
                }
            }
            else
            {
                AddLineCentered(title.ToUpperInvariant(), true, 2, 2);
            }
            PrintLogoLabel(doc.logo);
            AddSeparator('-');

            string code = budget != null ? budget.code : (meta != null ? meta.budgetCode : string.Empty);
            string validity = budget != null ? budget.validUntil : (meta != null ? meta.validUntil : string.Empty);
            string status = budget != null ? budget.status : string.Empty;
            string pdv = meta != null ? meta.pdv : string.Empty;
            string operatorName = meta != null ? (meta.@operator ?? meta.operatorName) : string.Empty;
            string date = meta != null ? meta.date : string.Empty;
            PrintMetaPair("Orcamento", code, "Validade", validity);
            PrintMetaPair("Status", status, "PDV", pdv);
            PrintMetaPair("Operador", operatorName, "Data", date);

            RenderSaleBody(doc);
        }

        private void RenderDanfeNfce(ReceiptDocument doc, bool isFiscal)
        {
            var meta = doc.meta;
            var totals = doc.totals;
            int rightWidth = Width >= 64 ? 14 : (Width >= 48 ? 12 : 10);
            string consultaUrl = meta != null ? meta.consultaUrl : string.Empty;
            string accessKey = meta != null ? meta.accessKey : string.Empty;
            string fiscalNumber = meta != null ? meta.fiscalNumber : string.Empty;
            string fiscalSerie = meta != null ? meta.fiscalSerie : string.Empty;
            string protocol = meta != null ? meta.protocol : string.Empty;
            string environment = meta != null ? meta.environment : string.Empty;

            string storeName = meta != null ? meta.store : string.Empty;
            if (!string.IsNullOrWhiteSpace(storeName))
            {
                AddLineCentered(storeName.ToUpperInvariant(), true);
            }

            if (doc.logo != null && !string.IsNullOrWhiteSpace(doc.logo.label))
            {
                if (!isFiscal && IsPlaceholderLabel(doc.logo.label))
                {
                    // skip placeholder for matricial
                }
                else
                {
                string raw = doc.logo.label.Replace('\r', '\n');
                string[] lines = raw.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
                if (lines.Length == 1 && raw.IndexOf('|') >= 0)
                {
                    lines = raw.Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries);
                }
                foreach (var line in lines)
                {
                    string trimmed = line.Trim();
                    if (trimmed.Length > 0)
                    {
                        AddLineCentered(trimmed.ToUpperInvariant(), false);
                    }
                }
                }
            }

            AddSeparator('-');
            if (isFiscal)
            {
                AddLineCentered("DANFE NFC-e - Documento Auxiliar", true);
                AddLineCentered("da Nota Fiscal Eletronica para", false);
                AddLineCentered("Consumidor Final", false);
                if (Width <= 42)
                {
                    AddLineCentered("Nao permite aproveitamento de credito de ICMS", false);
                }
            }
            else
            {
                AddLineCentered("COMPROVANTE DE VENDA", true);
                AddLineCentered("DOCUMENTO NAO FISCAL", false);
            }

            AddSeparator('-');
            AddLineCentered("DETALHE DA VENDA", true);
            AddSeparator('-');
            PrintDanfeItems(doc.items);

            AddLine(FormatColumnsCustom("QTD. TOTAL DE ITENS", (doc.items != null ? doc.items.Count : 0).ToString(), rightWidth));
            if (totals != null)
            {
                if (!string.IsNullOrWhiteSpace(totals.subtotal))
                {
                    AddLine(FormatColumnsCustom("VALOR DOS PRODUTOS", totals.subtotal, rightWidth));
                }
                bool discountPrinted = false;
                if ((totals.discountValue > 0 || !string.IsNullOrWhiteSpace(totals.discount)))
                {
                    string discountValue = !string.IsNullOrWhiteSpace(totals.discount)
                        ? totals.discount
                        : FormatCurrency(totals.discountValue);
                    AddLine(FormatColumnsCustom("DESCONTO", discountValue, rightWidth));
                    discountPrinted = true;
                }

                var promoLines = new List<string>();
                double promoTotal = 0;
                if (totals.promotions != null)
                {
                    foreach (var promo in totals.promotions)
                    {
                        if (promo == null)
                        {
                            continue;
                        }
                        string label = (promo.label ?? string.Empty).Trim();
                        if (string.IsNullOrWhiteSpace(label))
                        {
                            label = "DESCONTO";
                        }
                        string value = (promo.value ?? string.Empty).Trim();
                        if (string.IsNullOrWhiteSpace(value) && promo.amount > 0)
                        {
                            value = FormatCurrency(promo.amount);
                        }
                        if (string.IsNullOrWhiteSpace(value))
                        {
                            continue;
                        }
                        if (promo.amount > 0)
                        {
                            promoTotal += promo.amount;
                        }
                        promoLines.Add(FormatColumnsCustom(label.ToUpperInvariant(), value, rightWidth));
                    }
                }
                if (!discountPrinted && promoTotal > 0)
                {
                    AddLine(FormatColumnsCustom("DESCONTO", FormatCurrency(promoTotal), rightWidth));
                    discountPrinted = true;
                }
                foreach (var line in promoLines)
                {
                    AddLine(line);
                }
                if (totals.additionValue > 0 && !string.IsNullOrWhiteSpace(totals.addition))
                {
                    AddLine(FormatColumnsCustom("OUTRAS DESPESAS", totals.addition, rightWidth));
                }
                if (!string.IsNullOrWhiteSpace(totals.total))
                {
                    SetBold(true);
                    AddLine(FormatColumnsCustom("VALOR TOTAL R$", totals.total, rightWidth));
                    SetBold(false);
                }
            }

            AddSeparator('-');
            AddLine(FormatColumnsCustom("FORMAS DE PAGAMENTO", "Valor Pago", rightWidth));
            if (doc.payments != null)
            {
                foreach (var payment in doc.payments)
                {
                    if (payment == null) continue;
                    string label = payment.label ?? string.Empty;
                    string value = payment.value ?? string.Empty;
                    if (label.Length == 0 && value.Length == 0) continue;
                    AddLine(FormatColumnsCustom(label, value, rightWidth));
                }
            }

            AddSeparator('-');
            if (isFiscal)
            {
                bool hasAccessBlock = false;
                if (!string.IsNullOrWhiteSpace(consultaUrl))
                {
                    AddLineCentered("Consulta pela chave de acesso em:", false);
                    foreach (var line in WrapText(consultaUrl, Width))
                    {
                        AddLineCentered(line, false);
                    }
                    hasAccessBlock = true;
                }
                if (!string.IsNullOrWhiteSpace(accessKey))
                {
                    AddLineCentered("CHAVE DE ACESSO", true);
                    string formattedKey = FormatAccessKey(accessKey);
                    foreach (var line in WrapText(formattedKey, Width))
                    {
                        AddLineCentered(line, false);
                    }
                    hasAccessBlock = true;
                }
                if (hasAccessBlock)
                {
                    AddSeparator('-');
                }
            }
            AddLineCentered("CONSUMIDOR", true);
            if (doc.customer != null)
            {
                if (!string.IsNullOrWhiteSpace(doc.customer.name))
                {
                    AddLineCentered(("NOME: " + doc.customer.name).ToUpperInvariant(), false);
                }
                if (!string.IsNullOrWhiteSpace(doc.customer.document))
                {
                    AddLineCentered(("CONSUMIDOR: " + doc.customer.document).ToUpperInvariant(), false);
                }
                PrintCustomerPhonesCenteredCompact(doc.customer);
                if (!string.IsNullOrWhiteSpace(doc.customer.address))
                {
                    string upperAddress = doc.customer.address.ToUpperInvariant();
                    foreach (var line in WrapText(upperAddress, Width))
                    {
                        AddLineCentered(line, false);
                    }
                }
            }

            AddSeparator('-');
            string date = meta != null ? meta.date : string.Empty;
            if (!string.IsNullOrWhiteSpace(date))
            {
                AddLineCentered(date + " - Via Consumidor", false);
            }
            if (isFiscal)
            {
                if (!string.IsNullOrWhiteSpace(fiscalNumber) || !string.IsNullOrWhiteSpace(fiscalSerie))
                {
                    string numberLine = string.Format("No {0} Serie {1}", fiscalNumber, fiscalSerie).Trim();
                    AddLineCentered(numberLine, true);
                }
                if (!string.IsNullOrWhiteSpace(protocol))
                {
                    AddLineCentered("PROTOCOLO DE AUTORIZACAO", true);
                    AddLineCentered(protocol, false);
                }
            }

            if (HasQr(doc.qrCode))
            {
                AddSeparator('-');
                AddLineCentered("Consulta via leitor de QR Code", false);
                PrintQrCodeDanfe(doc.qrCode);
            }
            if (isFiscal &&
                !string.IsNullOrWhiteSpace(environment) &&
                environment.IndexOf("homolog", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                AddLineCentered("NFC-e EMITIDA PARA TESTE DE IMPRESSAO", true);
            }

            if (doc.footer != null && doc.footer.lines != null)
            {
                AddSeparator('-');
                foreach (var line in doc.footer.lines)
                {
                    AddLineCentered(line, false);
                }
            }
        }

        private void PrintDanfeItems(List<ReceiptItem> items)
        {
            if (items == null || items.Count == 0)
            {
                AddLine("SEM ITENS.");
                return;
            }

            var layout = ResolveDanfeItemLayout();
            AddLine(BuildDanfeItemHeader(layout));
            AddSeparator('-');
            foreach (var item in items)
            {
                PrintDanfeItemLine(item, layout);
            }
        }

        private DanfeItemLayout ResolveDanfeItemLayout()
        {
            var layout = new DanfeItemLayout();
            if (Width >= 48)
            {
                layout.CodeWidth = 6;
                layout.QtyWidth = 5;
                layout.UnitWidth = 2;
                layout.UnitPriceWidth = 7;
                layout.TotalWidth = 8;
            }
            else
            {
                layout.CodeWidth = Width <= 32 ? 5 : 6;
                layout.QtyWidth = Width <= 32 ? 3 : 5;
                layout.UnitWidth = 2;
                layout.UnitPriceWidth = Width <= 32 ? 5 : 6;
                layout.TotalWidth = Width <= 32 ? 5 : 6;
            }
            int fixedWidth = layout.CodeWidth + layout.QtyWidth + layout.UnitWidth +
                layout.UnitPriceWidth + layout.TotalWidth + 5;
            layout.DescWidth = Math.Max(1, Width - fixedWidth);
            return layout;
        }

        private void PrintDanfeItemLine(ReceiptItem item, DanfeItemLayout layout)
        {
            if (item == null)
            {
                return;
            }

            string code = (item.code ?? string.Empty).Trim();
            if (code.Length > layout.CodeWidth) code = code.Substring(0, layout.CodeWidth);
            string desc = (item.name ?? string.Empty).Trim();
            string descMain = desc.Length > layout.DescWidth ? desc.Substring(0, layout.DescWidth) : desc;
            string qty = (item.quantity ?? string.Empty).Trim();
            string unit = "UN";
            string unitPrice = (item.unitPrice ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(unitPrice))
            {
                unitPrice = "X " + unitPrice;
            }
            string total = (item.total ?? string.Empty).Trim();

            string qtyField = qty.Length > layout.QtyWidth ? qty.Substring(0, layout.QtyWidth) : qty.PadLeft(layout.QtyWidth);
            string unitField = unit.Length > layout.UnitWidth ? unit.Substring(0, layout.UnitWidth) : unit.PadRight(layout.UnitWidth);
            string unitPriceField = unitPrice.Length > layout.UnitPriceWidth
                ? unitPrice.Substring(0, layout.UnitPriceWidth)
                : unitPrice.PadLeft(layout.UnitPriceWidth);
            string totalField = total.Length > layout.TotalWidth
                ? total.Substring(0, layout.TotalWidth)
                : total.PadLeft(layout.TotalWidth);

            string line =
                code.PadRight(layout.CodeWidth) + " " +
                descMain.PadRight(layout.DescWidth) + " " +
                qtyField + " " +
                unitField + " " +
                unitPriceField + " " +
                totalField;
            AddLine(line);

            if (desc.Length > layout.DescWidth)
            {
                string rest = desc.Substring(layout.DescWidth).Trim();
                if (!string.IsNullOrWhiteSpace(rest))
                {
                    int indent = layout.CodeWidth + 1;
                    int wrapWidth = Math.Max(1, Width - indent);
                    foreach (var extra in WrapText(rest, wrapWidth))
                    {
                        AddLine(new string(' ', indent) + extra);
                    }
                }
            }
        }

        private void RenderSaleBody(ReceiptDocument doc)
        {
            var totals = doc.totals;
            if (doc.customer != null)
            {
                PrintSubsectionTitle("Cliente");
                AddLine("Nome: " + doc.customer.name);
                PrintMetaLine("Documento", doc.customer.document);
                if (!IsPhoneDuplicateOfCustomerPhones(doc.customer.contact, doc.customer))
                {
                    PrintMetaLine("Contato", doc.customer.contact);
                }
                PrintCustomerPhonesCompact(doc.customer);
                PrintMetaLine("Endereco", doc.customer.address);
                PrintMetaLine("Pet", doc.customer.pet);
            }

            if (doc.delivery != null)
            {
                PrintSubsectionTitle("Entrega");
                PrintMetaLine("Destino", doc.delivery.label);
                PrintMetaLine("Endereco", doc.delivery.address);
            }

            PrintSectionTitle("Itens");
            if (doc.items == null || doc.items.Count == 0)
            {
                AddLine("Nenhum item informado.");
            }
            else
            {
                AddLine(FormatColumns("Descricao", "Total"));
                AddSeparator('-');
                foreach (var item in doc.items)
                {
                    PrintItemLine(item);
                }
            }

            PrintSectionTitle("Totais");
            PrintValueLine("Subtotal", totals != null ? totals.subtotal : string.Empty);
            if (totals != null && totals.discountValue > 0)
            {
                PrintValueLine("Descontos", totals.discount);
            }
            if (totals != null && totals.promotions != null)
            {
                foreach (var promo in totals.promotions)
                {
                    PrintValueLine(promo.label, promo.value);
                }
            }
            if (totals != null && totals.additionValue > 0)
            {
                PrintValueLine("Acrescimos", totals.addition);
            }
            PrintEmphasisLine("TOTAL", totals != null ? totals.total : string.Empty);
            PrintValueLine("Pago", totals != null ? totals.paid : string.Empty);
            if (totals != null && totals.changeValue > 0)
            {
                PrintValueLine("Troco", totals.change);
            }

            PrintSectionTitle("Pagamentos");
            if (doc.payments == null || doc.payments.Count == 0)
            {
                AddLine("Nenhum pagamento registrado.");
            }
            else
            {
                foreach (var payment in doc.payments)
                {
                    PrintValueLine(payment.label, payment.value);
                }
            }

            PrintQrCode(doc.qrCode);

            if (doc.footer != null && doc.footer.lines != null)
            {
                AddSeparator('-');
                foreach (var line in doc.footer.lines)
                {
                    AddLineCentered(line, false);
                }
            }
        }
        private void RenderFechamento(ReceiptDocument doc)
        {
            var meta = doc.meta;
            var summary = doc.summary;
            string storeName = meta != null ? meta.store : string.Empty;
            string title = doc.title ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(storeName))
            {
                AddLineCentered(storeName, true, 2, 2);
                if (!string.IsNullOrWhiteSpace(title))
                {
                    AddLineCentered(title.ToUpperInvariant(), true);
                }
            }
            else
            {
                AddLineCentered(title.ToUpperInvariant(), true, 2, 2);
            }
            PrintLogoLabel(doc.logo);
            AddSeparator('-');

            var periodo = string.Empty;
            if (!string.IsNullOrWhiteSpace(meta != null ? meta.openedAt : string.Empty) ||
                !string.IsNullOrWhiteSpace(meta != null ? meta.closedAt : string.Empty))
            {
                periodo = string.Format("{0} -> {1}", meta != null ? meta.openedAt : string.Empty, meta != null ? meta.closedAt : string.Empty).Trim();
            }
            PrintMetaPair("PDV", meta != null ? meta.pdv : string.Empty, "Periodo", periodo);

            PrintSectionTitle("Resumo");
            PrintValueLine("Abertura", summary != null && summary.abertura != null ? summary.abertura.formatted : string.Empty);
            PrintValueLine("Recebido", summary != null && summary.recebido != null ? summary.recebido.formatted : string.Empty);
            PrintValueLine("Recebimentos cliente", summary != null && summary.recebimentosCliente != null ? summary.recebimentosCliente.formatted : string.Empty);
            PrintValueLine("Saldo", summary != null && summary.saldo != null ? summary.saldo.formatted : string.Empty);

            PrintSectionTitle("Recebimentos");
            RenderSection(doc.recebimentos, "Total recebido");

            PrintSectionTitle("Fechamento previsto");
            RenderSection(doc.previsto, "Total previsto");

            PrintSectionTitle("Fechamento apurado");
            RenderSection(doc.apurado, "Total apurado");
        }

        private void RenderSection(ReceiptSection section, string totalLabel)
        {
            if (section == null || section.items == null || section.items.Count == 0)
            {
                AddLine("Nenhum registro.");
                return;
            }

            foreach (var row in section.items)
            {
                PrintValueLine(row.label, row.value);
            }
            if (!string.IsNullOrWhiteSpace(section.formattedTotal))
            {
                PrintValueLine(totalLabel, section.formattedTotal);
            }
        }

        private void PrintLogoLabel(LogoInfo logo)
        {
            if (logo == null || string.IsNullOrWhiteSpace(logo.label))
            {
                return;
            }
            AddLineCentered(logo.label, false);
        }

        private void PrintMetaLine(string label, string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return;
            }
            AddLine(label + ": " + value);
        }

        private void PrintValueLine(string label, string value)
        {
            if (string.IsNullOrWhiteSpace(label))
            {
                return;
            }
            AddLine(FormatColumns(label, value ?? string.Empty));
        }

        private void PrintSectionTitle(string title)
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                return;
            }
            AddSeparator('-');
            SetBold(true);
            AddLineCentered(title.ToUpperInvariant(), false);
            SetBold(false);
        }

        private void PrintSubsectionTitle(string title)
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                return;
            }
            AddSeparator('-');
            SetBold(true);
            AddLine(title.ToUpperInvariant());
            SetBold(false);
        }

        private void PrintMetaPair(string leftLabel, string leftValue, string rightLabel, string rightValue)
        {
            string left = BuildLabel(leftLabel, leftValue);
            string right = BuildLabel(rightLabel, rightValue);
            if (!string.IsNullOrWhiteSpace(left) && !string.IsNullOrWhiteSpace(right))
            {
                AddLine(FormatColumns(left, right));
                return;
            }
            if (!string.IsNullOrWhiteSpace(left))
            {
                AddLine(left);
                return;
            }
            if (!string.IsNullOrWhiteSpace(right))
            {
                AddLine(right);
            }
        }

        private string NormalizePhoneDigitsText(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }
            var sb = new StringBuilder();
            foreach (char ch in value)
            {
                if (ch >= '0' && ch <= '9')
                {
                    sb.Append(ch);
                }
            }
            return sb.ToString();
        }

        private List<KeyValuePair<string, string>> BuildUniqueCustomerPhoneEntries(ReceiptCustomer customer)
        {
            var result = new List<KeyValuePair<string, string>>();
            if (customer == null)
            {
                return result;
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            Action<string, string> add = (label, value) =>
            {
                string raw = (value ?? string.Empty).Trim();
                if (raw.Length == 0) return;
                string digits = NormalizePhoneDigitsText(raw);
                string key = digits.Length > 0 ? digits : raw.ToUpperInvariant();
                if (seen.Contains(key)) return;
                seen.Add(key);
                result.Add(new KeyValuePair<string, string>(label, raw));
            };

            add("Cel", customer.celular);
            add("Tel", customer.telefone);
            add("Cel2", customer.celular2);
            add("Tel2", customer.telefone2);

            return result;
        }

        private bool IsPhoneDuplicateOfCustomerPhones(string value, ReceiptCustomer customer)
        {
            if (string.IsNullOrWhiteSpace(value) || customer == null)
            {
                return false;
            }
            string valueDigits = NormalizePhoneDigitsText(value);
            if (valueDigits.Length == 0)
            {
                return false;
            }
            foreach (var pair in BuildUniqueCustomerPhoneEntries(customer))
            {
                string candidateDigits = NormalizePhoneDigitsText(pair.Value);
                if (candidateDigits.Length == 0) continue;
                if (string.Equals(candidateDigits, valueDigits, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private void PrintCustomerPhonesCompact(ReceiptCustomer customer)
        {
            var entries = BuildUniqueCustomerPhoneEntries(customer);
            for (int i = 0; i < entries.Count; i += 2)
            {
                var left = entries[i];
                if (i + 1 < entries.Count)
                {
                    var right = entries[i + 1];
                    PrintMetaPair(left.Key, left.Value, right.Key, right.Value);
                }
                else
                {
                    PrintMetaLine(left.Key, left.Value);
                }
            }
        }

        private void PrintCustomerPhonesCenteredCompact(ReceiptCustomer customer)
        {
            var entries = BuildUniqueCustomerPhoneEntries(customer);
            for (int i = 0; i < entries.Count; i += 2)
            {
                string line;
                if (i + 1 < entries.Count)
                {
                    line = string.Format("{0}: {1} | {2}: {3}",
                        entries[i].Key, entries[i].Value,
                        entries[i + 1].Key, entries[i + 1].Value);
                }
                else
                {
                    line = string.Format("{0}: {1}", entries[i].Key, entries[i].Value);
                }
                foreach (var wrapped in WrapText(line.ToUpperInvariant(), Width))
                {
                    AddLineCentered(wrapped, false);
                }
            }
        }

        private void PrintEmphasisLine(string label, string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return;
            }
            string text = string.IsNullOrWhiteSpace(label) ? value : (label + " " + value);
            int maxCompact = Math.Max(10, Width / 2);
            if (text.Length <= maxCompact)
            {
                AddLineCentered(text, true, 2, 1);
                return;
            }
            SetBold(true);
            AddLine(FormatColumns(label ?? string.Empty, value));
            SetBold(false);
        }

        private void PrintItemLine(ReceiptItem item)
        {
            if (item == null)
            {
                return;
            }
            string title = string.Format("{0} {1}", item.index, item.name).Trim();
            foreach (var line in WrapText(title))
            {
                AddLine(line);
            }
            if (!string.IsNullOrWhiteSpace(item.code))
            {
                foreach (var line in WrapText("Codigo: " + item.code))
                {
                    AddLine(line);
                }
            }
            string quantity = string.IsNullOrWhiteSpace(item.quantity) ? string.Empty : item.quantity.Trim();
            string unit = string.IsNullOrWhiteSpace(item.unitPrice) ? string.Empty : item.unitPrice.Trim();
            string detail = string.Empty;
            if (!string.IsNullOrWhiteSpace(quantity) && !string.IsNullOrWhiteSpace(unit))
            {
                detail = string.Format("Qtd {0} x {1}", quantity, unit);
            }
            else if (!string.IsNullOrWhiteSpace(quantity))
            {
                detail = "Qtd " + quantity;
            }
            else if (!string.IsNullOrWhiteSpace(unit))
            {
                detail = "Unit " + unit;
            }
            string total = string.IsNullOrWhiteSpace(item.total) ? string.Empty : item.total.Trim();
            if (!string.IsNullOrWhiteSpace(detail) || !string.IsNullOrWhiteSpace(total))
            {
                AddLine(FormatColumns(detail, total));
            }
        }

        private string BuildLabel(string label, string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }
            return string.IsNullOrWhiteSpace(label) ? value : (label + ": " + value);
        }

        private string FormatColumns(string left, string right)
        {
            left = left ?? string.Empty;
            right = right ?? string.Empty;
            int rightWidth = Math.Max(6, RightColumnWidth);
            int leftWidth = Math.Max(1, Width - rightWidth - 1);
            if (right.Length > rightWidth)
            {
                right = right.Substring(0, rightWidth);
            }
            if (left.Length > leftWidth)
            {
                left = left.Substring(0, leftWidth);
            }
            return left.PadRight(leftWidth) + " " + right.PadLeft(rightWidth);
        }

        private string FormatColumnsCustom(string left, string right, int rightWidth)
        {
            left = left ?? string.Empty;
            right = right ?? string.Empty;
            rightWidth = Math.Max(6, rightWidth);
            int leftWidth = Math.Max(1, Width - rightWidth - 1);
            if (right.Length > rightWidth)
            {
                right = right.Substring(0, rightWidth);
            }
            if (left.Length > leftWidth)
            {
                left = left.Substring(0, leftWidth);
            }
            return left.PadRight(leftWidth) + " " + right.PadLeft(rightWidth);
        }

        private string BuildDanfeItemHeader(DanfeItemLayout layout)
        {
            string code = TruncateText("COD", layout.CodeWidth).PadRight(layout.CodeWidth);
            string desc = TruncateText("DESCRICAO", layout.DescWidth).PadRight(layout.DescWidth);
            string qty = TruncateText("QTD", layout.QtyWidth).PadLeft(layout.QtyWidth);
            string unit = TruncateText("UN", layout.UnitWidth).PadRight(layout.UnitWidth);
            string unitPrice = TruncateText("X VL.UN", layout.UnitPriceWidth).PadLeft(layout.UnitPriceWidth);
            string total = TruncateText("VL TOT", layout.TotalWidth).PadLeft(layout.TotalWidth);
            return code + " " + desc + " " + qty + " " + unit + " " + unitPrice + " " + total;
        }

        private string TruncateText(string value, int width)
        {
            if (string.IsNullOrEmpty(value) || width <= 0)
            {
                return string.Empty;
            }
            return value.Length > width ? value.Substring(0, width) : value;
        }

        private string FormatAccessKey(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return string.Empty;
            }
            var digits = new StringBuilder();
            foreach (var ch in raw)
            {
                if (char.IsDigit(ch))
                {
                    digits.Append(ch);
                }
            }
            string source = digits.Length > 0 ? digits.ToString() : raw.Trim();
            var grouped = new StringBuilder();
            for (int i = 0; i < source.Length; i++)
            {
                if (i > 0 && i % 4 == 0)
                {
                    grouped.Append(' ');
                }
                grouped.Append(source[i]);
            }
            return grouped.ToString();
        }

        private string FormatCurrency(double value)
        {
            string raw = value.ToString("0.00").Replace('.', ',');
            return "R$ " + raw;
        }

        private bool HasQr(ReceiptQrCode qrCode)
        {
            if (qrCode == null)
            {
                return false;
            }
            return !string.IsNullOrWhiteSpace(qrCode.payload) || !string.IsNullOrWhiteSpace(qrCode.image);
        }

        private bool IsPlaceholderLabel(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return false;
            }
            return value.Trim().IndexOf("em desenvolvimento", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private void PrintQrCode(ReceiptQrCode qrCode)
        {
            if (qrCode == null ||
                (string.IsNullOrWhiteSpace(qrCode.payload) && string.IsNullOrWhiteSpace(qrCode.image)))
            {
                return;
            }

            SetAlign(TextAlign.Center);
            AddLine("QRCode");
            if (TryPrintQrImage(qrCode))
            {
                return;
            }
            if (string.IsNullOrWhiteSpace(qrCode.payload))
            {
                return;
            }
            SetAlign(TextAlign.Center);
            var data = Encoding.UTF8.GetBytes(qrCode.payload);
            byte moduleSize = ResolveQrModuleSize(qrCode);
            byte errorCorrection = ResolveQrErrorCorrection(qrCode);
            var storeLength = data.Length + 3;
            byte pL = (byte)(storeLength % 256);
            byte pH = (byte)(storeLength / 256);
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00 });
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, moduleSize });
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, errorCorrection });
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30 });
            AppendBytes(data);
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30 });
            FeedLines(2);
            SetAlign(TextAlign.Left);
        }

        private void PrintQrCodeDanfe(ReceiptQrCode qrCode)
        {
            if (qrCode == null ||
                (string.IsNullOrWhiteSpace(qrCode.payload) && string.IsNullOrWhiteSpace(qrCode.image)))
            {
                return;
            }

            SetAlign(TextAlign.Center);
            if (TryPrintQrImage(qrCode))
            {
                return;
            }
            if (string.IsNullOrWhiteSpace(qrCode.payload))
            {
                return;
            }
            var data = Encoding.UTF8.GetBytes(qrCode.payload);
            byte moduleSize = ResolveQrModuleSize(qrCode);
            byte errorCorrection = ResolveQrErrorCorrection(qrCode);
            var storeLength = data.Length + 3;
            byte pL = (byte)(storeLength % 256);
            byte pH = (byte)(storeLength / 256);
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00 });
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, moduleSize });
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, errorCorrection });
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30 });
            AppendBytes(data);
            AppendBytes(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30 });
            FeedLines(2);
            SetAlign(TextAlign.Left);
        }

        private byte ResolveQrModuleSize(ReceiptQrCode qrCode)
        {
            int size = 0;
            if (qrCode != null && qrCode.moduleSize > 0)
            {
                size = qrCode.moduleSize;
            }
            if (size <= 0)
            {
                size = Width <= 42 ? 3 : 4;
            }
            size = Math.Max(1, Math.Min(16, size));
            return (byte)size;
        }

        private byte ResolveQrErrorCorrection(ReceiptQrCode qrCode)
        {
            string level = qrCode != null ? (qrCode.errorCorrection ?? string.Empty) : string.Empty;
            switch (level.Trim().ToUpperInvariant())
            {
                case "M":
                    return 0x31;
                case "Q":
                    return 0x32;
                case "H":
                    return 0x33;
                case "L":
                default:
                    return 0x30;
            }
        }

        private bool TryPrintQrImage(ReceiptQrCode qrCode)
        {
            if (qrCode == null || string.IsNullOrWhiteSpace(qrCode.image))
            {
                return false;
            }

            byte[] imageBytes = TryDecodeBase64(qrCode.image);
            if (imageBytes == null || imageBytes.Length == 0)
            {
                return false;
            }

            try
            {
                using (var ms = new MemoryStream(imageBytes))
                using (var source = new Bitmap(ms))
                {
                    if (source.Width <= 0 || source.Height <= 0)
                    {
                        return false;
                    }
                    int maxWidth = Width <= 42 ? 384 : 576;
                    using (var bitmap = ResizeBitmapToWidth(source, maxWidth))
                    {
                        SetAlign(TextAlign.Center);
                        PrintRasterImage(bitmap);
                        FeedLines(2);
                        SetAlign(TextAlign.Left);
                        return true;
                    }
                }
            }
            catch
            {
                return false;
            }
        }

        private byte[] TryDecodeBase64(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }
            string trimmed = value.Trim();
            int commaIndex = trimmed.IndexOf(',');
            if (trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && commaIndex >= 0)
            {
                trimmed = trimmed.Substring(commaIndex + 1);
            }
            try
            {
                return Convert.FromBase64String(trimmed);
            }
            catch
            {
                return null;
            }
        }

        private Bitmap ResizeBitmapToWidth(Bitmap source, int maxWidth)
        {
            if (source.Width <= maxWidth)
            {
                return new Bitmap(source);
            }
            double ratio = (double)maxWidth / source.Width;
            int targetWidth = maxWidth;
            int targetHeight = Math.Max(1, (int)Math.Round(source.Height * ratio));
            var resized = new Bitmap(targetWidth, targetHeight);
            using (var graphics = Graphics.FromImage(resized))
            {
                graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
                graphics.DrawImage(source, 0, 0, targetWidth, targetHeight);
            }
            return resized;
        }

        private void PrintRasterImage(Bitmap bitmap)
        {
            int width = bitmap.Width;
            int height = bitmap.Height;
            int bytesPerRow = (width + 7) / 8;
            var data = new byte[bytesPerRow * height];

            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    Color color = bitmap.GetPixel(x, y);
                    int luminance = (color.R + color.G + color.B) / 3;
                    bool isBlack = luminance < 128;
                    if (!isBlack)
                    {
                        continue;
                    }
                    int index = y * bytesPerRow + (x / 8);
                    data[index] |= (byte)(0x80 >> (x % 8));
                }
            }

            byte xL = (byte)(bytesPerRow % 256);
            byte xH = (byte)(bytesPerRow / 256);
            byte yL = (byte)(height % 256);
            byte yH = (byte)(height / 256);
            AppendBytes(new byte[] { 0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH });
            AppendBytes(data);
        }

        private void AddSeparator()
        {
            AddSeparator('-');
        }

        private void AddSeparator(char ch)
        {
            AddLine(new string(ch, Width));
        }

        private void AddLine(string text)
        {
            foreach (var line in WrapText(text))
            {
                WriteLine(line);
            }
        }

        private void AddLineCentered(string text, bool bold)
        {
            AddLineCentered(text, bold, 1, 1);
        }

        private void AddLineCentered(string text, bool bold, int widthMultiplier, int heightMultiplier)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return;
            }
            widthMultiplier = Math.Max(1, Math.Min(2, widthMultiplier));
            heightMultiplier = Math.Max(1, Math.Min(2, heightMultiplier));
            int maxWidth = Math.Max(1, Width / widthMultiplier);
            SetAlign(TextAlign.Center);
            SetTextSize(widthMultiplier, heightMultiplier);
            if (bold)
            {
                SetBold(true);
            }
            foreach (var line in WrapText(text, maxWidth))
            {
                WriteLine(line);
            }
            if (bold)
            {
                SetBold(false);
            }
            SetTextSize(1, 1);
            SetAlign(TextAlign.Left);
        }

        private void SetAlign(TextAlign align)
        {
            AppendBytes(new byte[] { 0x1B, 0x61, (byte)align });
        }

        private void SetBold(bool enabled)
        {
            AppendBytes(new byte[] { 0x1B, 0x45, enabled ? (byte)1 : (byte)0 });
        }

        private void SetUnderline(bool enabled)
        {
            AppendBytes(new byte[] { 0x1B, 0x2D, enabled ? (byte)1 : (byte)0 });
        }

        private void SetFont(FontMode font)
        {
            AppendBytes(new byte[] { 0x1B, 0x4D, (byte)font });
        }

        private void SetTextSize(int widthMultiplier, int heightMultiplier)
        {
            widthMultiplier = Math.Max(1, Math.Min(2, widthMultiplier));
            heightMultiplier = Math.Max(1, Math.Min(2, heightMultiplier));
            int value = ((widthMultiplier - 1) << 4) | (heightMultiplier - 1);
            AppendBytes(new byte[] { 0x1D, 0x21, (byte)value });
        }

        private void WriteLine(string text)
        {
            AppendText(text ?? string.Empty);
            NewLine();
        }

        private void AppendText(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return;
            }
            var bytes = Encoding.GetBytes(text);
            AppendBytes(bytes);
        }

        private void NewLine()
        {
            Buffer.Add(0x0A);
        }

        private void FeedLines(int count)
        {
            for (int i = 0; i < count; i++)
            {
                NewLine();
            }
        }

        private void Cut()
        {
            AppendBytes(new byte[] { 0x1D, 0x56, 0x42, 0x00 });
        }

        private void AppendBytes(byte[] bytes)
        {
            if (bytes == null || bytes.Length == 0)
            {
                return;
            }
            Buffer.AddRange(bytes);
        }

        private string FormatLine(string left, string right)
        {
            left = left ?? string.Empty;
            right = right ?? string.Empty;
            if (left.Length + right.Length + 1 > Width)
            {
                int maxLeft = Math.Max(0, Width - right.Length - 1);
                if (left.Length > maxLeft)
                {
                    left = left.Substring(0, maxLeft);
                }
            }
            int spaces = Width - left.Length - right.Length;
            if (spaces < 1)
            {
                spaces = 1;
            }
            return left + new string(' ', spaces) + right;
        }

        private IEnumerable<string> WrapText(string text)
        {
            return WrapText(text, Width);
        }

        private IEnumerable<string> WrapText(string text, int maxWidth)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return new List<string>();
            }

            maxWidth = Math.Max(1, maxWidth);
            var lines = new List<string>();
            var words = text.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            var current = new StringBuilder();

            foreach (var word in words)
            {
                if (word.Length > maxWidth)
                {
                    if (current.Length > 0)
                    {
                        lines.Add(current.ToString());
                        current.Clear();
                    }
                    int index = 0;
                    while (index < word.Length)
                    {
                        int length = Math.Min(maxWidth, word.Length - index);
                        lines.Add(word.Substring(index, length));
                        index += length;
                    }
                    continue;
                }

                if (current.Length == 0)
                {
                    current.Append(word);
                    continue;
                }

                if (current.Length + 1 + word.Length <= maxWidth)
                {
                    current.Append(' ').Append(word);
                }
                else
                {
                    lines.Add(current.ToString());
                    current.Clear();
                    current.Append(word);
                }
            }

            if (current.Length > 0)
            {
                lines.Add(current.ToString());
            }

            return lines;
        }
    }
    public enum TextAlign : byte
    {
        Left = 0,
        Center = 1,
        Right = 2
    }

    public class CodePageInfo
    {
        public int DotNetCodePage { get; set; }
        public int EscPosCode { get; set; }

        public static CodePageInfo Resolve(string value)
        {
            var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            switch (normalized)
            {
                case "cp850":
                case "850":
                    return new CodePageInfo { DotNetCodePage = 850, EscPosCode = 2 };
                case "cp1252":
                case "1252":
                    return new CodePageInfo { DotNetCodePage = 1252, EscPosCode = 16 };
                case "cp437":
                case "437":
                    return new CodePageInfo { DotNetCodePage = 437, EscPosCode = 0 };
                case "cp860":
                case "860":
                default:
                    return new CodePageInfo { DotNetCodePage = 860, EscPosCode = 3 };
            }
        }
    }

    public class Logger
    {
        private readonly object Lock = new object();
        private readonly string LogPath;
        private readonly string ErrPath;

        public Logger(string baseDir)
        {
            LogPath = Path.Combine(baseDir, "agent.log");
            ErrPath = Path.Combine(baseDir, "agent.err");
        }

        public void Info(string message)
        {
            Write(LogPath, message);
            Console.WriteLine(message);
        }

        public void Error(string message)
        {
            Write(ErrPath, message);
            Console.Error.WriteLine(message);
        }

        private void Write(string path, string message)
        {
            string line = string.Format("[{0}] {1}", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), message);
            try
            {
                lock (Lock)
                {
                    using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                    using (var writer = new StreamWriter(stream, Encoding.UTF8))
                    {
                        writer.WriteLine(line);
                    }
                }
            }
            catch
            {
            }
        }
    }

    public class RawPrinterHelper
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
        public class DOCINFOA
        {
            [MarshalAs(UnmanagedType.LPStr)]
            public string pDocName;
            [MarshalAs(UnmanagedType.LPStr)]
            public string pOutputFile;
            [MarshalAs(UnmanagedType.LPStr)]
            public string pDataType;
        }

        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
        public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

        [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

        public static bool SendBytesToPrinter(string printerName, byte[] bytes)
        {
            if (string.IsNullOrWhiteSpace(printerName) || bytes == null || bytes.Length == 0)
            {
                return false;
            }

            IntPtr hPrinter = IntPtr.Zero;
            DOCINFOA di = new DOCINFOA
            {
                pDocName = "PDV Receipt",
                pDataType = "RAW"
            };

            bool success = false;
            try
            {
                if (!OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero))
                {
                    return false;
                }

                if (!StartDocPrinter(hPrinter, 1, di))
                {
                    return false;
                }

                if (!StartPagePrinter(hPrinter))
                {
                    return false;
                }

                IntPtr unmanagedBytes = Marshal.AllocHGlobal(bytes.Length);
                Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
                int written;
                success = WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written);
                Marshal.FreeHGlobal(unmanagedBytes);

                EndPagePrinter(hPrinter);
                EndDocPrinter(hPrinter);
            }
            finally
            {
                ClosePrinter(hPrinter);
            }

            return success;
        }
    }
}
