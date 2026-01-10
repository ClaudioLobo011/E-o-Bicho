using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PdvLocalAgentSetup
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                string installDir = ResolveInstallDir(args);
                string tempDir = Path.Combine(Path.GetTempPath(), "pdv-local-agent-setup-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tempDir);

                string zipPath = Path.Combine(tempDir, "pdv-local-agent.zip");
                ExtractEmbeddedZip(zipPath);

                string payloadDir = Path.Combine(tempDir, "payload");
                ZipFile.ExtractToDirectory(zipPath, payloadDir);

                StopAgentProcesses();

                CopyDirectory(payloadDir, installDir);
                EnsureConfig(installDir);

                RunInstallScript(installDir);

                TryDeleteDirectory(tempDir);

                MessageBox.Show(
                    "Agente instalado/atualizado com sucesso.",
                    "PDV Local Agent",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Falha ao instalar o agente.\n\n" + ex.Message,
                    "PDV Local Agent",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }
        }

        private static string ResolveInstallDir(string[] args)
        {
            if (args != null)
            {
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (args[i] == "--dir")
                    {
                        string value = args[i + 1];
                        if (!string.IsNullOrWhiteSpace(value))
                        {
                            return Path.GetFullPath(value.Trim());
                        }
                    }
                }
            }

            string baseDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(baseDir, "PdvLocalAgent");
        }

        private static void ExtractEmbeddedZip(string outputPath)
        {
            var assembly = Assembly.GetExecutingAssembly();
            using (var stream = assembly.GetManifestResourceStream("pdv-local-agent.zip"))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("Pacote embutido nao encontrado.");
                }
                using (var file = new FileStream(outputPath, FileMode.Create, FileAccess.Write))
                {
                    stream.CopyTo(file);
                }
            }
        }

        private static void StopAgentProcesses()
        {
            try
            {
                var processes = Process.GetProcessesByName("pdv-local-agent");
                foreach (var proc in processes)
                {
                    try
                    {
                        proc.Kill();
                        proc.WaitForExit(4000);
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }
        }

        private static void CopyDirectory(string sourceDir, string targetDir)
        {
            if (!Directory.Exists(sourceDir))
            {
                throw new DirectoryNotFoundException("Pasta de origem nao encontrada.");
            }
            Directory.CreateDirectory(targetDir);
            var files = Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories);
            foreach (var file in files)
            {
                string relative = file.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar);
                string destination = Path.Combine(targetDir, relative);
                string destinationDir = Path.GetDirectoryName(destination) ?? targetDir;
                Directory.CreateDirectory(destinationDir);

                if (string.Equals(relative, "agent-config.json", StringComparison.OrdinalIgnoreCase) &&
                    File.Exists(destination))
                {
                    continue;
                }

                File.Copy(file, destination, true);
            }
        }

        private static void EnsureConfig(string installDir)
        {
            string configPath = Path.Combine(installDir, "agent-config.json");
            if (File.Exists(configPath))
            {
                return;
            }
            string examplePath = Path.Combine(installDir, "agent-config.example.json");
            if (File.Exists(examplePath))
            {
                File.Copy(examplePath, configPath, true);
            }
        }

        private static void RunInstallScript(string installDir)
        {
            string installScript = Path.Combine(installDir, "install-agent.bat");
            if (!File.Exists(installScript))
            {
                return;
            }
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c \"" + installScript + "\"",
                WorkingDirectory = installDir,
                CreateNoWindow = true,
                UseShellExecute = false
            };
            using (var process = Process.Start(psi))
            {
                if (process == null)
                {
                    return;
                }
                process.WaitForExit(15000);
            }
        }

        private static void TryDeleteDirectory(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return;
            }
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
            }
            catch
            {
            }
        }
    }
}
