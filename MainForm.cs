using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using SteelPackingApp.Models;
using SteelPackingApp.Services;

namespace SteelViewerApp;

/// <summary>
/// Native WinForms shell. Everything is driven from here:
///   - "Upload Shipping List Excel..." reads the file (ExcelReader), builds the
///     raw scene (SceneBuilder), and pushes it into the embedded 3D view.
///   - "Quick view" / "Optimize packing" just click the matching buttons
///     inside the embedded page - the packing algorithms themselves live in
///     Viewer3D.html's JavaScript (that is genuinely where 3D rendering has
///     to happen; WinForms has no built-in 3D surface), but the whole
///     workflow - pick file, load it, switch modes - is controlled from this
///     native C# window.
/// </summary>
public class MainForm : Form
{
    private readonly WebView2 webView = new();
    private readonly Button btnUpload = new();
    private readonly Button btnUploadIfc = new();
    private readonly Button btnLoadJson = new();
    private readonly Button btnQuick = new();
    private readonly Button btnOptimize = new();
    private readonly Label lblStatus = new();
    private readonly Container containerSpec = new(); // edit Models/Container.cs to change 40ft defaults

    private bool webViewReady = false;

    public MainForm()
    {
        Text = "Steel Container 3D Viewer";
        Width = 1280;
        Height = 820;
        StartPosition = FormStartPosition.CenterScreen;

        var topPanel = new Panel { Dock = DockStyle.Top, Height = 46, Padding = new Padding(8) };

        btnUpload.Text = "Upload Shipping List Excel...";
        btnUpload.AutoSize = true;
        btnUpload.Location = new Point(8, 10);
        btnUpload.Click += BtnUpload_Click;

        btnUploadIfc.Text = "Upload IFC...";
        btnUploadIfc.AutoSize = true;
        btnUploadIfc.Click += BtnUploadIfc_Click;

        btnLoadJson.Text = "Load scene JSON...";
        btnLoadJson.AutoSize = true;
        btnLoadJson.Click += BtnLoadJson_Click;

        btnQuick.Text = "Quick view";
        btnQuick.AutoSize = true;
        btnQuick.Enabled = false;
        btnQuick.Click += (s, e) => RunJs("document.getElementById('btnQuick').click();");

        btnOptimize.Text = "Optimize packing";
        btnOptimize.AutoSize = true;
        btnOptimize.Enabled = false;
        btnOptimize.Click += (s, e) => RunJs("document.getElementById('btnOptimize').click();");

        lblStatus.AutoSize = true;
        lblStatus.Text = "No file loaded yet.";
        lblStatus.ForeColor = Color.DimGray;

        topPanel.Controls.Add(btnUpload);
        topPanel.Controls.Add(btnUploadIfc);
        topPanel.Controls.Add(btnLoadJson);
        topPanel.Controls.Add(btnQuick);
        topPanel.Controls.Add(btnOptimize);
        topPanel.Controls.Add(lblStatus);

        // simple horizontal layout without a designer file
        Load += (s, e) => LayoutTopPanel(topPanel);
        Resize += (s, e) => LayoutTopPanel(topPanel);

        webView.Dock = DockStyle.Fill;

        Controls.Add(webView);
        Controls.Add(topPanel);

        Load += MainForm_Load;
    }

    private void LayoutTopPanel(Panel panel)
    {
        int x = 8;
        foreach (Control c in panel.Controls)
        {
            c.Location = new Point(x, 11);
            x += c.Width + 14;
        }
    }

    private async void MainForm_Load(object? sender, EventArgs e)
    {
        try
        {
            await webView.EnsureCoreWebView2Async();
            string htmlPath = Path.Combine(AppContext.BaseDirectory, "Viewer3D.html");
            webView.CoreWebView2.Navigate(new Uri(htmlPath).AbsoluteUri);
            webView.CoreWebView2.NavigationCompleted += (s2, e2) =>
            {
                webViewReady = true;
                btnQuick.Enabled = true;
                btnOptimize.Enabled = true;
            };
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Could not start the embedded browser (WebView2). Make sure the " +
                "'WebView2 Runtime' is installed - it ships with Windows 10/11 and Edge " +
                "by default, but if this fails you can download it from Microsoft's site.\n\n" +
                ex.Message,
                "WebView2 error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void BtnUploadIfc_Click(object? sender, EventArgs e)
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Select a Tekla IFC export",
            Filter = "IFC files (*.ifc)|*.ifc|All files (*.*)|*.*"
        };

        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        Cursor = Cursors.WaitCursor;
        try
        {
            var phases = IfcAssemblyReader.ListPhases(dialog.FileName);
            double? phaseFilter = null;

            if (phases.Count > 1)
            {
                var counts = new List<(double Phase, int Count)>();
                foreach (var p in phases)
                {
                    var (_, itemsForCount, _) = IfcAssemblyReader.Convert(dialog.FileName, p);
                    counts.Add((p, itemsForCount.Count));
                }

                Cursor = Cursors.Default;
                using var picker = new PhasePickerForm(counts);
                if (picker.ShowDialog(this) != DialogResult.OK) return;
                Cursor = Cursors.WaitCursor;

                if (!picker.AllPhasesChosen) phaseFilter = picker.SelectedPhase;
            }

            var (job, items, skipped) = IfcAssemblyReader.Convert(dialog.FileName, phaseFilter);

            if (items.Count == 0)
            {
                MessageBox.Show(
                    "No assemblies were found for this selection. This app expects Tekla's " +
                    "'ACERO_DATA' and 'Tekla Assembly'/'Tekla Quantity' property sets - if your " +
                    "IFC export doesn't include those, check the Tekla IFC export settings.",
                    "No items found", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var scene = SceneBuilder.BuildRawScene(job, containerSpec, items);
            string json = JsonSerializer.Serialize(scene, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });
            string jsLiteral = JsonSerializer.Serialize(json);
            RunJs($"loadSceneFromDotNet({jsLiteral});");

            double totalWeight = items.Sum(i => i.TotalWeightKg);
            string phaseText = phaseFilter.HasValue ? $"Phase {phaseFilter:0}" : "All phases";
            lblStatus.Text = $"{job.JobNo}  |  {phaseText}  |  {items.Count} assemblies " +
                              $"({skipped} skipped - no usable part), {Math.Round(totalWeight, 1)} kg total";
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not read this IFC file:\n\n" + ex.Message,
                "Error reading file", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            Cursor = Cursors.Default;
        }
    }

    private void BtnLoadJson_Click(object? sender, EventArgs e)
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Select a scene JSON file (e.g. produced by ifc_to_scene.py)",
            Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*"
        };

        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        try
        {
            string json = File.ReadAllText(dialog.FileName);
            using var doc = JsonDocument.Parse(json); // validate it's actually JSON before pushing to the browser

            string jsLiteral = JsonSerializer.Serialize(json);
            RunJs($"loadSceneFromDotNet({jsLiteral});");

            string jobNo = doc.RootElement.TryGetProperty("jobNo", out var j) ? j.GetString() ?? "" : "";
            int itemCount = doc.RootElement.TryGetProperty("items", out var itemsEl) ? itemsEl.GetArrayLength() : 0;
            lblStatus.Text = $"Loaded from JSON: {jobNo}  |  {itemCount} assembly rows";
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not read this JSON file:\n\n" + ex.Message,
                "Error reading file", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void BtnUpload_Click(object? sender, EventArgs e)
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Select a Shipping List Excel file",
            Filter = "Excel files (*.xlsx)|*.xlsx|All files (*.*)|*.*"
        };

        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        try
        {
            var (job, items) = ExcelReader.ReadShippingList(dialog.FileName);

            if (items.Count == 0)
            {
                MessageBox.Show(
                    "No assembly rows were found. This app expects the standard AEM " +
                    "Shipping List layout (job info in row 6, headers in row 8, data from " +
                    "row 10). If your export looks different, adjust Services/ExcelReader.cs.",
                    "No items found", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var scene = SceneBuilder.BuildRawScene(job, containerSpec, items);
            string json = JsonSerializer.Serialize(scene, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            // Serialize again so the JSON string becomes a safely-escaped JS string literal
            string jsLiteral = JsonSerializer.Serialize(json);
            RunJs($"loadSceneFromDotNet({jsLiteral});");

            int totalPieces = items.Sum(i => i.Qty);
            double totalWeight = items.Sum(i => i.TotalWeightKg);
            lblStatus.Text = $"{job.JobNo}  |  Bldg {job.BldgNo}  Phase {job.PhaseNo}  |  " +
                              $"{items.Count} assembly types, {totalPieces} pieces, " +
                              $"{Math.Round(totalWeight, 1)} kg total";
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not read this Excel file:\n\n" + ex.Message,
                "Error reading file", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void RunJs(string script)
    {
        if (!webViewReady || webView.CoreWebView2 == null) return;
        _ = webView.CoreWebView2.ExecuteScriptAsync(script);
    }
}
