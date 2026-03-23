// 知识图谱管理
let network = null;
let nodes = new vis.DataSet([]);
let edges = new vis.DataSet([]);
let currentItemId = null;
let currentTargetLabel = null;
let suggestionTimeout = null;
let nodeCountHint = null;
let clusteredNodes = new Set();
let clusterInfo = {
    clusterId: null,
    childNodes: []
};

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    console.log('页面加载完成，初始化...');
    initEventListeners();
    initGraph();

    setTimeout(() => {
        addLayoutControls();
    }, 100);

    updatePlaceholderByType();
});

function initEventListeners() {
    document.getElementById('searchInput').addEventListener('input', function() {
        clearTimeout(suggestionTimeout);
        const query = this.value.trim();

        if (query.length >= 2) {
            suggestionTimeout = setTimeout(() => {
                getSuggestions(query);
            }, 300);
        } else {
            document.getElementById('searchResults').innerHTML = '';
        }
    });

    document.getElementById('searchBtn').addEventListener('click', performSearch);

    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    document.getElementById('searchType').addEventListener('change', function() {
        updatePlaceholderByType();
        updateTitlesByType();

        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('searchInput').value = '';

        if (network) {
            nodes.clear();
            edges.clear();
            document.getElementById('graph-container').innerHTML = '<div id="graph-container"></div>';
            initGraph();
        }

        clearAllInfoDisplays();
    });

    document.getElementById('zoomIn').addEventListener('click', function() {
        if (network) network.moveTo({scale: network.getScale() * 1.2});
    });

    document.getElementById('zoomOut').addEventListener('click', function() {
        if (network) network.moveTo({scale: network.getScale() * 0.8});
    });

    document.getElementById('fitGraph').addEventListener('click', function() {
        if (network) network.fit();
    });
}

function updatePlaceholderByType() {
    const searchType = document.getElementById('searchType').value;
    const searchInput = document.getElementById('searchInput');

    switch(searchType) {
        case 'drug':
            searchInput.placeholder = '请输入药物名称或ID';
            break;
        case 'gene':
            searchInput.placeholder = '请输入基因名称或符号';
            break;
        case 'protein':
            searchInput.placeholder = '请输入蛋白质名称';
            break;
    }
}

function updateTitlesByType() {
    const searchType = document.getElementById('searchType').value;
    const molecularTitle = document.getElementById('molecular-title');
    const detailsTitle = document.getElementById('details-title');
    const molIdLabel = document.getElementById('mol-id-label');

    switch(searchType) {
        case 'drug':
            molecularTitle.textContent = '分子结构信息';
            detailsTitle.textContent = '相互作用详情';
            if (molIdLabel) molIdLabel.textContent = '标识符:';
            break;
        case 'gene':
            molecularTitle.textContent = '基因信息';
            detailsTitle.textContent = '相关通路';
            if (molIdLabel) molIdLabel.textContent = '基因ID:';
            break;
        case 'protein':
            molecularTitle.textContent = '蛋白质信息';
            detailsTitle.textContent = '相关通路';
            if (molIdLabel) molIdLabel.textContent = 'UniProt ID:';
            break;
    }
}

function clearAllInfoDisplays() {
    const searchType = document.getElementById('searchType').value;

    document.getElementById('mol-name').textContent = '-';
    document.getElementById('mol-drugbank-ids').textContent = '-';
    document.getElementById('mol-cas').textContent = '-';
    document.getElementById('mol-uni').textContent = '-';
    document.getElementById('mol-state').textContent = '-';
    document.getElementById('mol-groups').textContent = '-';

    const structureContainer = document.getElementById('structureImageContainer');
    const placeholder = document.querySelector('.structure-placeholder');
    if (structureContainer && placeholder) {
        structureContainer.style.display = 'none';
        placeholder.style.display = 'block';
        if (searchType === 'drug') {
            placeholder.innerHTML = '<p>请选择一个药物查看分子结构</p>';
        } else if (searchType === 'gene') {
            placeholder.innerHTML = '<p>🧬 基因无分子结构</p><p style="font-size: 11px;">请查看基因信息</p>';
        } else if (searchType === 'protein') {
            placeholder.innerHTML = '<p>⚛️ 蛋白质无分子结构</p><p style="font-size: 11px;">请查看蛋白质信息</p>';
        }
    }

    const descElement = document.getElementById('mol-description');
    if (descElement) {
        const p = descElement.querySelector('p') || document.createElement('p');
        if (searchType === 'drug') {
            p.textContent = '请选择一个药物查看详细信息';
        } else if (searchType === 'gene') {
            p.textContent = '请选择一个基因查看详细信息';
        } else if (searchType === 'protein') {
            p.textContent = '请选择一个蛋白质查看详细信息';
        }
        if (!descElement.querySelector('p')) descElement.appendChild(p);
    }

    const interactionsList = document.getElementById('interactionsList');
    if (searchType === 'drug') {
        interactionsList.innerHTML = '<p class="placeholder">请选择一个药物查看相互作用详情</p>';
    } else if (searchType === 'gene') {
        interactionsList.innerHTML = '<p class="placeholder">请选择一个基因查看通路中的节点</p>';
    } else if (searchType === 'protein') {
        interactionsList.innerHTML = '<p class="placeholder">请选择一个蛋白质查看通路中的节点</p>';
    }

    const selectedInfo = document.querySelector('.selected-info .info-content');
    if (selectedInfo) {
        selectedInfo.innerHTML = '<p class="placeholder">请选择一个项目</p>';
    }
}

function addLayoutControls() {
    const controls = document.querySelector('.graph-controls');
    if (!controls) return;

    const existingButtons = controls.querySelectorAll('button:not(#zoomIn):not(#zoomOut):not(#fitGraph)');
    existingButtons.forEach(btn => btn.remove());

    const clusterBtn = document.createElement('button');
    clusterBtn.id = 'clusterBtn';
    clusterBtn.innerHTML = '聚类';
    clusterBtn.title = '将相关节点聚合成簇';
    clusterBtn.onclick = clusterGraph;
    controls.appendChild(clusterBtn);

    const expandBtn = document.createElement('button');
    expandBtn.id = 'expandBtn';
    expandBtn.innerHTML = '展开全部';
    expandBtn.title = '展开所有聚类节点';
    expandBtn.onclick = expandAllClusters;
    controls.appendChild(expandBtn);

    const resetBtn = document.createElement('button');
    resetBtn.id = 'resetViewBtn';
    resetBtn.innerHTML = '重置';
    resetBtn.title = '重置视图';
    resetBtn.onclick = resetView;
    controls.appendChild(resetBtn);
}

function clusterGraph() {
    if (!network) {
        showNotification('图谱未初始化');
        return;
    }

    const searchType = document.getElementById('searchType').value;
    if (searchType !== 'drug') {
        showNotification('聚类功能仅适用于药物图谱');
        return;
    }

    let hasRelatedNodes = false;
    nodes.forEach(node => {
        if (node.group === 'related') {
            hasRelatedNodes = true;
        }
    });

    if (!hasRelatedNodes) {
        showNotification('没有可聚类的相关节点');
        return;
    }

    clusteredNodes.clear();
    clusterInfo = {
        clusterId: null,
        childNodes: []
    };

    const relatedNodes = [];
    nodes.forEach(node => {
        if (node.group === 'related') {
            relatedNodes.push(node.id);
        }
    });

    const clusterId = 'cluster_' + Date.now();

    const clusterOptions = {
        joinCondition: function(childNode) {
            return childNode.group === 'related';
        },
        clusterNodeProperties: {
            id: clusterId,
            label: `相关药物簇 (${relatedNodes.length})`,
            group: 'cluster',
            shape: 'box',
            size: 30,
            color: {
                background: '#3a4050',
                border: '#00bcd4'
            },
            font: {
                color: '#e0e0e0',
                size: 12,
                bold: true
            },
            title: `包含 ${relatedNodes.length} 个相关药物`
        },
        processProperties: function(clusterNode, childNodes, childEdges) {
            childNodes.forEach(node => {
                clusteredNodes.add(node.id);
            });
            clusterInfo = {
                clusterId: clusterId,
                childNodes: childNodes.map(n => n.id)
            };
            return clusterNode;
        }
    };

    try {
        network.cluster(clusterOptions);
        showNotification(`已聚类 ${relatedNodes.length} 个相关节点`);

        setTimeout(() => {
            updateInteractionsList(edges.get());
        }, 500);
    } catch (e) {
        console.error('聚类失败:', e);
        showNotification('聚类失败');
    }
}

function expandCluster() {
    if (!network) return false;

    if (!clusterInfo.clusterId) {
        showNotification('没有可展开的聚类');
        return false;
    }

    try {
        network.openCluster(clusterInfo.clusterId);

        clusteredNodes.clear();
        clusterInfo = {
            clusterId: null,
            childNodes: []
        };

        showNotification('已展开聚类');

        setTimeout(() => {
            network.fit();
            updateInteractionsList(edges.get());
        }, 500);

        return true;
    } catch (e) {
        console.error('展开聚类失败:', e);
        showNotification('展开聚类失败');
        return false;
    }
}

function expandAllClusters() {
    expandCluster();
}

function resetView() {
    if (!network) return;

    expandCluster();

    setTimeout(() => {
        network.setOptions({
            physics: {
                enabled: true,
                stabilization: true
            }
        });

        network.fit({
            animation: {
                duration: 500
            }
        });
    }, 600);

    showNotification('视图已重置');
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'graph-notification';
    notification.textContent = message;

    document.querySelector('.graph-card').appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 2000);
}

function getSuggestions(query) {
    const searchType = document.getElementById('searchType').value;

    fetch(`/api/suggestions?type=${searchType}&q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => displaySuggestions(data))
        .catch(error => console.error('Suggestions error:', error));
}

function displaySuggestions(suggestions) {
    const container = document.getElementById('searchResults');

    if (suggestions.length === 0) {
        container.innerHTML = '<div class="result-item">无匹配结果</div>';
        return;
    }

    let html = '<div class="suggestions-header">搜索建议</div>';

    suggestions.forEach(suggestion => {
        let icon = '';
        let typeColor = '';
        let displayName = suggestion.display_name || suggestion.name;

        if (suggestion.type === 'drug') {
            icon = '💊';
            typeColor = '#00bcd4';
        } else if (suggestion.type === 'gene') {
            icon = '🧬';
            typeColor = '#4caf50';
        } else if (suggestion.type === 'protein') {
            icon = '⚛️';
            typeColor = '#ff9800';
        }

        const sourceBadge = suggestion.source ?
            `<span class="source-badge" style="margin-left: 5px; display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; background: #2a2f3a; color: #8a8f99;">${suggestion.source}</span>` : '';

        const itemId = suggestion.id;

        html += `<div class="result-item suggestion-item"
                    onclick="selectItem('${itemId}', '${displayName.replace(/'/g, "\\'")}')"
                    data-type="${suggestion.type}"
                    data-source="${suggestion.source || ''}">`;
        html += `<div class="name" style="color: ${typeColor};">${icon} ${displayName} ${sourceBadge}</div>`;

        if (suggestion.full_name) {
            html += `<div class="desc" style="color: #8a8f99; font-size: 11px;">全称: ${suggestion.full_name}</div>`;
        }

        if (suggestion.pathway_name) {
            html += `<div class="desc" style="color: #9c27b0;">通路: ${suggestion.pathway_name}</div>`;
        }

        if (suggestion.organism) {
            html += `<div class="desc" style="color: #8a8f99;">${suggestion.organism}</div>`;
        }

        html += `<div class="desc">${suggestion.description || ''}</div>`;
        html += '</div>';
    });

    container.innerHTML = html;
}

function performSearch() {
    const searchType = document.getElementById('searchType').value;
    const query = document.getElementById('searchInput').value.trim();

    if (!query || query.length < 2) {
        document.getElementById('searchResults').innerHTML = '<div class="result-item">请输入至少2个字符</div>';
        return;
    }

    document.getElementById('searchResults').innerHTML = '<div class="result-item">搜索中...</div>';

    fetch(`/api/search?type=${searchType}&q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => displaySearchResults(data))
        .catch(error => {
            console.error('Search error:', error);
            document.getElementById('searchResults').innerHTML = '<div class="result-item">搜索出错，请重试</div>';
        });
}

function displaySearchResults(results) {
    const container = document.getElementById('searchResults');

    if (results.length === 0) {
        container.innerHTML = '<div class="result-item">未找到相关结果</div>';
        return;
    }

    let html = '<div class="suggestions-header">搜索结果</div>';

    results.forEach(result => {
        let icon = '';
        let typeColor = '';
        let displayName = result.display_name || result.name;

        if (result.type === 'drug') {
            icon = '💊';
            typeColor = '#00bcd4';
        } else if (result.type === 'gene') {
            icon = '🧬';
            typeColor = '#4caf50';
        } else if (result.type === 'protein') {
            icon = '⚛️';
            typeColor = '#ff9800';
        }

        const sourceBadge = result.source ?
            `<span class="source-badge" style="margin-left: 5px; display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; background: #2a2f3a; color: #8a8f99;">${result.source}</span>` : '';

        const itemId = result.chembl_id || result.id;

        html += `<div class="result-item"
                    onclick="selectItem('${itemId}', '${displayName.replace(/'/g, "\\'")}')"
                    data-type="${result.type}"
                    data-source="${result.source || ''}">`;
        html += `<div class="name" style="color: ${typeColor};">${icon} ${displayName} ${sourceBadge}</div>`;

        if (result.full_name) {
            html += `<div class="desc" style="color: #8a8f99; font-size: 11px;">全称: ${result.full_name}</div>`;
        }

        if (result.pathway_name) {
            html += `<div class="desc" style="color: #9c27b0;">通路: ${result.pathway_name}</div>`;
        }

        if (result.organism) {
            html += `<div class="desc" style="color: #8a8f99;">${result.organism}</div>`;
        }

        if (result.max_phase !== undefined) {
            const phaseText = result.max_phase === 0 ? '临床前' :
                              result.max_phase === 1 ? 'Phase I' :
                              result.max_phase === 2 ? 'Phase II' :
                              result.max_phase === 3 ? 'Phase III' :
                              result.max_phase === 4 ? '已上市' : `Phase ${result.max_phase}`;
            html += `<div class="desc" style="color: #8a8f99;">临床阶段: ${phaseText}</div>`;
        }

        html += `<div class="desc">${result.description || ''}</div>`;
        html += '</div>';
    });

    container.innerHTML = html;
}

function selectItem(itemId, itemLabel) {
    console.log('选择项目 - ID:', itemId, '标签:', itemLabel);

    if (!itemId) {
        showNotification('无效的项目ID');
        return;
    }

    const searchType = document.getElementById('searchType').value;

    document.querySelectorAll('.result-item').forEach(item => {
        item.classList.remove('selected');
    });

    const selectedItem = Array.from(document.querySelectorAll('.result-item')).find(item => {
        const onclick = item.getAttribute('onclick');
        return onclick && onclick.includes(itemId);
    });

    if (selectedItem) {
        selectedItem.classList.add('selected');
    }

    currentItemId = itemId;
    currentTargetLabel = itemLabel || '';

    clusteredNodes.clear();
    clusterInfo = {
        clusterId: null,
        childNodes: []
    };

    if (network) {
        nodes.clear();
        edges.clear();
    }

    const graphHeader = document.querySelector('.graph-card .card-header h2');
    if (graphHeader) {
        graphHeader.innerHTML = '知识图谱';
    }

    if (searchType === 'drug') {
        if (itemId.startsWith('CHEMBL')) {
            console.log('加载ChEMBL药物图谱');
            loadChemblGraph(itemId);
        } else {
            console.log('加载DrugBank药物图谱');
            loadDrugGraph(itemId);
        }
        loadMolecularInfo(itemId);
        updateSelectedInfo(itemId);
    } else {
        if (itemId.length === 24 && /^[0-9a-fA-F]+$/.test(itemId)) {
            loadPathwayGraph(itemId, currentTargetLabel);
            updatePathwayInfo(itemId);
        } else if (itemId.startsWith('CHEMBL')) {
            console.log('加载ChEMBL靶点图谱');
            loadChemblGraph(itemId);
        }
        clearMolecularInfoForGene();
    }
}

// 加载ChEMBL图谱
function loadChemblGraph(chemblId) {
    document.getElementById('graph-container').innerHTML = '<div class="graph-loading">加载ChEMBL知识图谱中...</div>';

    const interactionsList = document.getElementById('interactionsList');
    if (interactionsList) {
        interactionsList.innerHTML = '<p class="placeholder">加载关系中...</p>';
    }

    fetch(`/api/chembl/graph/${chemblId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                document.getElementById('graph-container').innerHTML = `<div class="graph-error">错误: ${data.error}</div>`;
                return;
            }

            initGraph();
            nodes.clear();
            edges.clear();

            if (data.nodes) {
                // 确保每个节点有正确的类型和颜色
                const processedNodes = data.nodes.map(node => {
                    // 判断是否是中心节点（当前选中）
                    const isCenter = (node.id === data.center_id);

                    // 确定节点类型（优先使用 node.type，如果没有则根据 group 推断）
                    let nodeType = node.type;
                    if (!nodeType || nodeType === 'unknown') {
                        if (node.group === 'gene') nodeType = 'gene';
                        else if (node.group === 'protein') nodeType = 'protein';
                        else if (node.group === 'pathway') nodeType = 'pathway';
                        else nodeType = 'drug';
                    }

                    if (isCenter) {
                        // 中心节点使用星形，根据类型设置颜色
                        node.group = 'center';
                        node.shape = 'star';
                        if (nodeType === 'drug') {
                            node.color = { background: '#00bcd4', border: '#ffffff' };
                            node.icon = '💊';
                        } else if (nodeType === 'gene') {
                            node.color = { background: '#4caf50', border: '#ffffff' };
                            node.icon = '🧬';
                        } else if (nodeType === 'protein') {
                            node.color = { background: '#ff9800', border: '#ffffff' };
                            node.icon = '⚛️';
                        } else if (nodeType === 'pathway') {
                            node.color = { background: '#9c27b0', border: '#ffffff' };
                            node.icon = '🔬';
                        } else {
                            node.color = { background: '#00bcd4', border: '#ffffff' };
                            node.icon = '💊';
                        }
                    } else {
                        // 非中心节点使用圆形，根据类型设置颜色
                        node.shape = 'dot';
                        if (nodeType === 'drug') {
                            node.group = 'drug';
                            node.color = { background: '#00bcd4', border: '#ffffff' };
                            node.icon = '💊';
                        } else if (nodeType === 'gene') {
                            node.group = 'gene';
                            node.color = { background: '#4caf50', border: '#ffffff' };
                            node.icon = '🧬';
                        } else if (nodeType === 'protein') {
                            node.group = 'protein';
                            node.color = { background: '#ff9800', border: '#ffffff' };
                            node.icon = '⚛️';
                        } else if (nodeType === 'pathway') {
                            node.group = 'pathway';
                            node.color = { background: '#9c27b0', border: '#ffffff' };
                            node.icon = '🔬';
                        } else {
                            // 默认按药物处理
                            node.group = 'drug';
                            node.color = { background: '#00bcd4', border: '#ffffff' };
                            node.icon = '💊';
                        }
                    }

                    // 确保节点有正确的 label
                    if (!node.label || node.label === node.id) {
                        if (node.details && node.details.name) {
                            node.label = node.details.name;
                        } else if (node.title) {
                            const match = node.title.match(/:[ ]*(.+)/);
                            node.label = match ? match[1] : node.id;
                        } else {
                            node.label = node.id;
                        }
                    }
                    return node;
                });
                nodes.add(processedNodes);
            }

            if (data.edges && data.edges.length > 0) {
                edges.add(data.edges);
            }

            const graphHeader = document.querySelector('.graph-card .card-header h2');
            if (graphHeader) {
                let typeText = data.type === 'drug' ? '药物' : (data.type === 'gene' ? '基因' : '蛋白质');
                graphHeader.innerHTML = `ChEMBL ${typeText}图谱: ${data.drug_name} <span class="graph-stats">(显示 ${data.displayed_interactions} 个关系)</span>`;
            }

            addNodeCountHint({
                nodes: data.nodes,
                edges: data.edges
            });

            updateRelationshipList(data.edges, data.nodes);

            if (data.center_id) {
                setTimeout(() => {
                    network.selectNodes([data.center_id]);
                    network.focus(data.center_id, {
                        scale: 1.2,
                        animation: {
                            duration: 500
                        }
                    });
                }, 500);
            }
        })
        .catch(error => {
            console.error('加载ChEMBL图谱失败:', error);
            document.getElementById('graph-container').innerHTML = '<div class="graph-error">加载失败</div>';
        });
}


// 加载DrugBank药物图谱
function loadDrugGraph(drugId) {
    if (!drugId) {
        console.error('药物ID为空');
        showNotification('无效的药物ID');
        return;
    }

    document.getElementById('graph-container').innerHTML = '<div class="graph-loading">加载药物相互作用图谱中...</div>';

    clusteredNodes.clear();
    clusterInfo = {
        clusterId: null,
        childNodes: []
    };

    const interactionsList = document.getElementById('interactionsList');
    if (interactionsList) {
        interactionsList.innerHTML = '<p class="placeholder">加载中...</p>';
    }

    fetch(`/api/graph/${drugId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                document.getElementById('graph-container').innerHTML = `<div class="graph-error">错误: ${data.error}</div>`;
                showNotification(data.error);
                return;
            }

            initGraph();

            nodes.clear();
            edges.clear();

            if (data.nodes && data.nodes.length > 0) {
                // 处理节点：中心节点和相关节点都按类型着色
                const processedNodes = data.nodes.map(node => {
                    if (node.group === 'center') {
                        node.group = 'center';
                        node.shape = 'star';
                        node.color = { background: '#00bcd4', border: '#ffffff' };
                        node.icon = '💊';
                        node.label = node.label || node.id;
                    } else if (node.group === 'related') {
                        // 相关节点根据 type 设置颜色
                        node.type = node.type || 'drug';
                        node.shape = 'dot';
                        if (node.type === 'drug') {
                            node.group = 'drug';
                            node.color = { background: '#00bcd4', border: '#ffffff' };
                            node.icon = '💊';
                        } else if (node.type === 'gene') {
                            node.group = 'gene';
                            node.color = { background: '#4caf50', border: '#ffffff' };
                            node.icon = '🧬';
                        } else if (node.type === 'protein') {
                            node.group = 'protein';
                            node.color = { background: '#ff9800', border: '#ffffff' };
                            node.icon = '⚛️';
                        } else {
                            node.group = 'drug';
                            node.color = { background: '#00bcd4', border: '#ffffff' };
                            node.icon = '💊';
                        }
                    }
                    return node;
                });
                nodes.add(processedNodes);
            }

            if (data.edges && data.edges.length > 0) {
                edges.add(data.edges);
            }

            const graphHeader = document.querySelector('.graph-card .card-header h2');
            if (graphHeader) {
                if (data.displayed_interactions > 0) {
                    graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats">(显示 ${data.displayed_interactions} 个相互作用)</span>`;
                } else {
                    graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats">(无相互作用数据)</span>`;
                }
            }

            addNodeCountHint({
                nodes: data.nodes,
                edges: data.edges,
                has_more: data.has_more,
                remaining_count: data.remaining_count
            });

            updateInteractionsList(data.edges);

            if (data.target_node_id) {
                setTimeout(() => {
                    network.selectNodes([data.target_node_id]);
                    network.focus(data.target_node_id, {
                        scale: 1.2,
                        animation: {
                            duration: 500
                        }
                    });
                }, 500);
            }
        })
        .catch(error => {
            console.error('Load drug graph error:', error);
            document.getElementById('graph-container').innerHTML = '<div class="graph-error">加载图谱失败: ' + error.message + '</div>';
            showNotification('加载图谱失败: ' + error.message);
        });
}


// 加载通路图谱
function loadPathwayGraph(pathwayId, targetNodeLabel) {
    if (!pathwayId) {
        console.error('通路ID为空');
        showNotification('无效的通路ID');
        return;
    }

    document.getElementById('graph-container').innerHTML = '<div class="graph-loading">加载通路图谱中...</div>';

    let url = '/api/pathway/graph/' + encodeURIComponent(pathwayId);
    if (targetNodeLabel) {
        url += '?target=' + encodeURIComponent(targetNodeLabel);
    }

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                document.getElementById('graph-container').innerHTML = '<div class="graph-error">错误: ' + data.error + '</div>';
                showNotification(data.error);
                return;
            }

            initGraph();

            nodes.clear();
            edges.clear();

            if (data.nodes && data.nodes.length > 0) {
                // 处理节点：设置正确的类型和颜色
                const modifiedNodes = data.nodes.map(node => {
                    if (node.type === 'gene') {
                        node.group = 'gene';
                        node.color = { background: '#4caf50', border: '#ffffff' };
                        node.icon = '🧬';
                    } else if (node.type === 'protein') {
                        node.group = 'protein';
                        node.color = { background: '#ff9800', border: '#ffffff' };
                        node.icon = '⚛️';
                    } else if (node.type === 'pathway') {
                        node.group = 'pathway';
                        node.color = { background: '#9c27b0', border: '#ffffff' };
                        node.icon = '🔬';
                    }

                    if (node.is_target) {
                        if (node.type === 'gene') {
                            node.group = 'target_gene';
                        } else if (node.type === 'protein') {
                            node.group = 'target_protein';
                        }
                    }
                    return node;
                });
                nodes.add(modifiedNodes);
            }

            if (data.edges && data.edges.length > 0) {
                edges.add(data.edges);
            }

            const graphHeader = document.querySelector('.graph-card .card-header h2');
            if (graphHeader) {
                graphHeader.innerHTML = '通路图谱: ' + data.pathway_name + ' <span class="graph-stats">(' + data.organism + ')</span>';
            }

            addNodeCountHint({
                nodes: data.nodes,
                edges: data.edges,
                gene_count: data.gene_count,
                protein_count: data.protein_count
            });

            if (data.target_node_id) {
                setTimeout(() => {
                    network.selectNodes([data.target_node_id]);
                    network.focus(data.target_node_id, {
                        scale: 1.5,
                        animation: {
                            duration: 500
                        }
                    });

                    const targetNode = nodes.get(data.target_node_id);
                    if (targetNode) {
                        showGeneProteinDetails(targetNode);
                    }
                }, 500);
            } else if (data.center_id) {
                setTimeout(() => {
                    network.selectNodes([data.center_id]);
                    network.focus(data.center_id, {
                        scale: 1.2,
                        animation: {
                            duration: 500
                        }
                    });
                }, 500);
            }

            updatePathwayNodeList(data.nodes, data.target_node_id);
        })
        .catch(error => {
            console.error('Load pathway graph error:', error);
            document.getElementById('graph-container').innerHTML = '<div class="graph-error">加载通路图谱失败: ' + error.message + '</div>';
            showNotification('加载通路图谱失败: ' + error.message);
        });
}

// 加载分子结构 - 修复SMILES显示
function loadDrugStructure(drugId) {
    const structureContainer = document.getElementById('structureImageContainer');
    const placeholder = document.querySelector('.structure-placeholder');
    const imgElement = document.getElementById('drugStructureImage');
    const smilesElement = document.getElementById('structureSmiles');

    if (!structureContainer || !placeholder || !imgElement || !smilesElement) {
        console.error('分子结构容器未找到');
        return;
    }

    // 显示加载状态
    placeholder.style.display = 'block';
    placeholder.innerHTML = '<p>🔍 正在查询分子结构...</p>';
    structureContainer.style.display = 'none';

    console.log(`正在加载分子结构: ${drugId}`);

    fetch(`/api/drug/${encodeURIComponent(drugId)}/structure`)
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || `HTTP ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                placeholder.style.display = 'block';
                placeholder.innerHTML = `<p>⚠️ ${data.error}</p>`;
                return;
            }

            if (!data.image) {
                placeholder.style.display = 'block';
                placeholder.innerHTML = '<p>⚠️ 未找到分子结构图像</p>';
                return;
            }

            // 显示图像
            imgElement.src = 'data:image/png;base64,' + data.image;
            imgElement.style.display = 'block';

            // 处理SMILES显示：如果太长，截断显示
            let smilesText = data.smiles || '';
            if (smilesText.length > 80) {
                smilesText = smilesText.substring(0, 80) + '...';
            }
            smilesElement.textContent = 'SMILES: ' + smilesText;

            // 添加完整SMILES的悬浮提示
            if (data.smiles && data.smiles.length > 80) {
                smilesElement.title = '完整SMILES: ' + data.smiles;
                smilesElement.style.cursor = 'help';
            }

            placeholder.style.display = 'none';
            structureContainer.style.display = 'flex';

            console.log(`成功加载分子结构: ${data.name}`);
        })
        .catch(error => {
            console.error('加载分子结构失败:', error);
            placeholder.style.display = 'block';
            placeholder.innerHTML = `<p>❌ 加载分子结构失败</p><p style="font-size: 11px;">${error.message}</p>`;
            structureContainer.style.display = 'none';
        });
}

function addNodeCountHint(data) {
    if (nodeCountHint) {
        nodeCountHint.remove();
    }

    nodeCountHint = document.createElement('div');
    nodeCountHint.className = 'node-count-hint';

    let hintText = `<span>📊 节点: ${data.nodes.length} | 边: ${data.edges.length}</span>`;

    if (data.gene_count !== undefined) {
        hintText += `<span class="more-hint"> | 🧬基因: ${data.gene_count} ⚛️蛋白: ${data.protein_count}</span>`;
    }

    if (data.has_more) {
        hintText += `<span class="more-hint"> | 还有 ${data.remaining_count} 个未显示</span>`;
    }

    nodeCountHint.innerHTML = hintText;
    document.querySelector('.graph-card').appendChild(nodeCountHint);
}

function updateRelationshipList(edges, nodes) {
    const container = document.getElementById('interactionsList');

    if (!edges || edges.length === 0) {
        container.innerHTML = '<p class="placeholder">暂无关系数据</p>';
        return;
    }

    let html = '<div class="interaction-item" style="background: #1a1f2b;"><div class="drug-name" style="color: #00bcd4;">📊 关系列表</div></div>';

    edges.forEach((edge, index) => {
        const targetNode = nodes.find(n => n.id === edge.to);
        if (!targetNode) return;

        const displayName = targetNode.label || targetNode.id;
        const icon = targetNode.icon || '🔗';

        const relationType = edge.title ? edge.title.split('\n')[0].replace('关系: ', '') : '相互作用';
        const extraInfo = edge.title ? edge.title.split('\n').slice(1).join(' ') : '';

        html += `
            <div class="interaction-item" style="${index % 2 === 0 ? 'background: #1a1f2b;' : ''}">
                <div class="drug-name" style="color: ${targetNode.color?.background || '#00bcd4'}">${icon} ${displayName}</div>
                <div class="description">${relationType}</div>
                ${extraInfo ? `<div class="description" style="font-size: 10px; color: #8a8f99;">${extraInfo}</div>` : ''}
                ${targetNode.details?.organism ? `<div class="description" style="font-size: 10px;">生物体: ${targetNode.details.organism}</div>` : ''}
            </div>
        `;
    });

    container.innerHTML = html;
}

function updateInteractionsList(edges) {
    const container = document.getElementById('interactionsList');
    const detailsTitle = document.getElementById('details-title');

    if (detailsTitle) {
        detailsTitle.textContent = '相互作用详情';
    }

    if (!container) return;

    if (!edges || edges.length === 0) {
        container.innerHTML = '<p class="placeholder">该药物暂无相互作用数据</p>';
        return;
    }

    let html = '';
    let displayedCount = 0;
    let hasMoreNode = false;

    edges.forEach(edge => {
        if (edge.to && edge.to.toString().startsWith('more_')) {
            hasMoreNode = true;
            return;
        }

        const targetNode = nodes.get(edge.to);
        if (!targetNode) return;

        if (clusteredNodes.has(targetNode.id)) return;

        displayedCount++;
        const drugName = targetNode.label || '未知药物';
        const icon = targetNode.icon || '💊';
        const description = edge.title || '相互作用描述';

        html += `
            <div class="interaction-item">
                <div class="drug-name">${icon} ${drugName}</div>
                <div class="description">${description}</div>
            </div>
        `;
    });

    if (displayedCount === 0) {
        if (hasMoreNode) {
            container.innerHTML = '<p class="placeholder">有更多未显示的相互作用，请点击"更多"节点查看</p>';
        } else if (clusterInfo.clusterId) {
            container.innerHTML = '<p class="placeholder">节点已被聚类，请点击聚类节点展开查看详细信息</p>';
        } else {
            container.innerHTML = '<p class="placeholder">该药物暂无相互作用数据</p>';
        }
    } else {
        const statsHtml = `
            <div class="interaction-item" style="background: #1a1f2b; border-bottom: 1px solid #2a2f3a;">
                <div class="drug-name" style="color: #00bcd4;">📊 相互作用列表</div>
                <div class="description">共 ${displayedCount} 个相互作用</div>
            </div>
        `;
        container.innerHTML = statsHtml + html;
    }
}

function updatePathwayNodeList(nodes, targetNodeId) {
    const container = document.getElementById('interactionsList');
    const detailsTitle = document.getElementById('details-title');
    const searchType = document.getElementById('searchType').value;

    if (detailsTitle) {
        detailsTitle.textContent = searchType === 'gene' ? '基因列表' : '蛋白质列表';
    }

    if (!nodes || nodes.length <= 1) {
        container.innerHTML = '<p class="placeholder">该通路暂无节点数据</p>';
        return;
    }

    let html = '';
    let geneCount = 0;
    let proteinCount = 0;
    let targetNode = null;

    if (targetNodeId) {
        targetNode = nodes.find(n => n.id === targetNodeId);
    }

    if (targetNode) {
        const icon = targetNode.icon || (targetNode.type === 'gene' ? '🧬' : '⚛️');
        const color = targetNode.type === 'gene' ? '#4caf50' : '#ff9800';
        html += `
            <div class="interaction-item" style="border-left: 4px solid #00bcd4; background: #1e232f; margin-bottom: 10px;">
                <div class="drug-name" style="color: ${color}; font-size: 15px;">
                    ${icon} ${targetNode.label} ⭐
                </div>
                <div class="description" style="color: #00bcd4;">当前搜索的目标</div>
            </div>
        `;
    }

    html += '<div style="margin-top: 10px;">';
    nodes.forEach(node => {
        if (node.group === 'pathway' || node.id === targetNodeId) return;

        if (node.type === 'gene') {
            geneCount++;
            const icon = node.icon || '🧬';
            html += `
                <div class="interaction-item">
                    <div class="drug-name" style="color: #4caf50;">${icon} ${node.label}</div>
                    <div class="description">基因节点</div>
                </div>
            `;
        } else if (node.type === 'protein') {
            proteinCount++;
            const icon = node.icon || '⚛️';
            html += `
                <div class="interaction-item">
                    <div class="drug-name" style="color: #ff9800;">${icon} ${node.label}</div>
                    <div class="description">蛋白质节点</div>
                </div>
            `;
        }
    });
    html += '</div>';

    const statsHtml = `
        <div class="interaction-item" style="background: #1a1f2b; border-top: 1px solid #2a2f3a; margin-top: 10px;">
            <div class="drug-name" style="color: #9c27b0;">📊 节点统计</div>
            <div class="description">🧬 基因: ${geneCount} | ⚛️ 蛋白质: ${proteinCount}</div>
        </div>
    `;

    container.innerHTML = statsHtml + html;
}

function loadMolecularInfo(drugId) {
    fetch(`/api/drug/${drugId}/molecular_info`)
        .then(response => response.json())
        .then(data => {
            if (data.error) return;

            if (data.source === 'chembl') {
                updateMolecularInfoForChembl(data);
            } else {
                document.getElementById('mol-name').textContent = data.name || '-';

                const drugbankElement = document.getElementById('mol-drugbank-ids');
                if (drugbankElement) {
                    drugbankElement.textContent = data.drugbank_ids ? data.drugbank_ids.join(', ') : '-';
                }

                document.getElementById('mol-cas').textContent = data.cas_number || '-';
                document.getElementById('mol-uni').textContent = data.uni || '-';
                document.getElementById('mol-state').textContent = data.state || '-';
                document.getElementById('mol-groups').textContent = data.groups ? data.groups.join(', ') : '-';
                document.getElementById('mol-id-label').textContent = 'DrugBank IDs:';

                const descElement = document.getElementById('mol-description');
                if (descElement) {
                    const p = descElement.querySelector('p') || document.createElement('p');
                    p.textContent = data.description || '暂无描述';
                    if (!descElement.querySelector('p')) descElement.appendChild(p);
                }
            }

            loadDrugStructure(drugId);
        })
        .catch(error => console.error('Load molecular info error:', error));
}

function updateMolecularInfoForChembl(drug) {
    document.getElementById('mol-name').textContent = drug.name || '-';
    document.getElementById('mol-id-label').textContent = 'ChEMBL ID:';
    document.getElementById('mol-drugbank-ids').textContent = drug.chembl_id || '-';
    document.getElementById('mol-cas').textContent = drug.cas_number || 'N/A';

    if (drug.uni) {
        document.getElementById('mol-uni').textContent = drug.uni;
    } else if (drug.properties && drug.properties.full_molformula) {
        document.getElementById('mol-uni').textContent = drug.properties.full_molformula;
    } else {
        document.getElementById('mol-uni').textContent = '-';
    }

    if (drug.state) {
        const phaseText = drug.state === 0 ? '临床前' :
                          drug.state === 1 ? 'Phase I' :
                          drug.state === 2 ? 'Phase II' :
                          drug.state === 3 ? 'Phase III' :
                          drug.state === 4 ? '已上市' : `Phase ${drug.state}`;
        document.getElementById('mol-state').textContent = phaseText;
    } else {
        document.getElementById('mol-state').textContent = '-';
    }

    if (drug.groups && drug.groups !== 'N/A') {
        document.getElementById('mol-groups').textContent = drug.groups;
    } else if (drug.basic_info && drug.basic_info.molecule_type) {
        document.getElementById('mol-groups').textContent = drug.basic_info.molecule_type;
    } else {
        document.getElementById('mol-groups').textContent = '-';
    }

    const descElement = document.getElementById('mol-description');
    if (descElement) {
        const p = descElement.querySelector('p') || document.createElement('p');
        let descText = '【ChEMBL药物信息】\n';

        if (drug.basic_info) {
            descText += `\n📋 基本信息：`;
            if (drug.basic_info.molecule_type) descText += `\n  类型: ${drug.basic_info.molecule_type}`;
            if (drug.basic_info.max_phase !== undefined) descText += `\n  最高临床阶段: ${drug.basic_info.max_phase === 4 ? '已上市' : `Phase ${drug.basic_info.max_phase}`}`;
            if (drug.basic_info.first_approval) descText += `\n  首次批准: ${drug.basic_info.first_approval}`;
        }

        if (drug.properties) {
            descText += `\n\n🧪 理化性质：`;
            if (drug.properties.full_mwt) descText += `\n  分子量: ${drug.properties.full_mwt}`;
            if (drug.properties.alogp) descText += `\n  LogP: ${drug.properties.alogp}`;
            if (drug.properties.hba) descText += `\n  氢键受体: ${drug.properties.hba}`;
            if (drug.properties.hbd) descText += `\n  氢键供体: ${drug.properties.hbd}`;
        }

        p.textContent = descText;
        p.style.whiteSpace = 'pre-line';
        p.style.fontSize = '12px';
        p.style.lineHeight = '1.5';
        if (!descElement.querySelector('p')) descElement.appendChild(p);
    }
}

function showGeneProteinDetails(node) {
    const container = document.getElementById('interactionsList');
    const detailsTitle = document.getElementById('details-title');

    const isTarget = node.group === 'target_gene' || node.group === 'target_protein';
    const typeIcon = node.icon || (node.group.includes('gene') ? '🧬' : '⚛️');
    const typeName = node.group.includes('gene') ? '基因' : '蛋白质';
    const typeColor = node.group.includes('gene') ? '#4caf50' : '#ff9800';

    if (detailsTitle) {
        detailsTitle.textContent = typeName + '详情';
    }

    const titleInfo = node.title || '';
    const dbMatch = titleInfo.match(/Database: ([^\n]+)/);
    const idMatch = titleInfo.match(/ID: ([^\n]+)/);

    let xrefInfo = '';
    if (dbMatch && idMatch) {
        xrefInfo = `
            <div class="info-item" style="margin-top: 10px;">
                <span class="label" style="width: 70px;">数据库:</span>
                <span class="value">${dbMatch[1]}</span>
            </div>
            <div class="info-item">
                <span class="label" style="width: 70px;">ID:</span>
                <span class="value" style="font-family: monospace;">${idMatch[1]}</span>
            </div>
        `;
    }

    const highlightStyle = isTarget ? 'border-left: 4px solid #00bcd4; background: #1e232f;' : '';
    const starIcon = isTarget ? ' ⭐' : '';

    container.innerHTML = `
        <div class="interaction-item" style="${highlightStyle}">
            <div class="drug-name" style="color: ${typeColor}; font-size: 16px; margin-bottom: 8px;">
                ${typeIcon} ${node.label}${starIcon}
            </div>
            <div class="info-item">
                <span class="label" style="width: 50px;">类型:</span>
                <span class="value">${typeName}</span>
            </div>
            ${xrefInfo}
            <div class="info-item" style="margin-top: 10px;">
                <span class="label" style="width: 50px;">通路:</span>
                <span class="value" style="color: #9c27b0;">${document.querySelector('.graph-card .card-header h2')?.textContent.replace('通路图谱: ', '') || '未知'}</span>
            </div>
        </div>
    `;
}

function clearMolecularInfoForGene() {
    document.getElementById('mol-name').textContent = '-';
    document.getElementById('mol-drugbank-ids').textContent = '-';
    document.getElementById('mol-cas').textContent = '-';
    document.getElementById('mol-uni').textContent = '-';
    document.getElementById('mol-state').textContent = '-';
    document.getElementById('mol-groups').textContent = '-';

    const structureContainer = document.getElementById('structureImageContainer');
    const placeholder = document.querySelector('.structure-placeholder');
    if (structureContainer && placeholder) {
        structureContainer.style.display = 'none';
        placeholder.style.display = 'block';
        placeholder.innerHTML = '<p>🧬 基因/蛋白质无分子结构</p>';
    }
}

// ========== 当前选择信息 - 修复版 ==========
function updateSelectedInfo(drugId) {
    fetch(`/api/drug/${drugId}`)
        .then(response => response.json())
        .then(data => {
            const container = document.querySelector('.selected-info .info-content');
            if (data.error) {
                container.innerHTML = '<p class="placeholder">信息加载失败</p>';
                console.error('API返回错误:', data.error);
                return;
            }

            console.log('当前选择数据:', data);

            let source = data.source || 'unknown';
            let sourceBadge = `<span class="source-badge" style="display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; background: #2a2f3a; color: #8a8f99; margin-left: 5px;">${source}</span>`;

            if (source === 'drugbank') {
                let groups = data.groups ? data.groups.join(', ') : 'N/A';
                let drugbankIds = data.drugbank_ids ? data.drugbank_ids.join(', ') : 'N/A';

                container.innerHTML = `
                    <div class="info-item"><span class="label">名称:</span><span class="value">${data.name || 'N/A'} ${sourceBadge}</span></div>
                    <div class="info-item"><span class="label">DrugBank IDs:</span><span class="value">${drugbankIds}</span></div>
                    <div class="info-item"><span class="label">CAS号:</span><span class="value">${data.cas_number || 'N/A'}</span></div>
                    <div class="info-item"><span class="label">UNI:</span><span class="value">${data.uni || 'N/A'}</span></div>
                    <div class="info-item"><span class="label">状态:</span><span class="value">${data.state || 'N/A'}</span></div>
                    <div class="info-item"><span class="label">分组:</span><span class="value">${groups}</span></div>
                `;
            } else if (source === 'chembl') {
                let chemblId = data.chembl_id || 'N/A';
                let maxPhase = data.basic_info?.max_phase !== undefined ?
                    (data.basic_info.max_phase === 4 ? '已上市' :
                     data.basic_info.max_phase === 0 ? '临床前' :
                     `Phase ${data.basic_info.max_phase}`) : 'N/A';
                let moleculeType = data.basic_info?.molecule_type || 'N/A';
                let firstApproval = data.basic_info?.first_approval || 'N/A';
                let molFormula = data.properties?.full_molformula || 'N/A';

                container.innerHTML = `
                    <div class="info-item"><span class="label">名称:</span><span class="value">${data.name || 'N/A'} ${sourceBadge}</span></div>
                    <div class="info-item"><span class="label">ChEMBL ID:</span><span class="value">${chemblId}</span></div>
                    <div class="info-item"><span class="label">分子类型:</span><span class="value">${moleculeType}</span></div>
                    <div class="info-item"><span class="label">最高阶段:</span><span class="value">${maxPhase}</span></div>
                    <div class="info-item"><span class="label">首次批准:</span><span class="value">${firstApproval}</span></div>
                    <div class="info-item"><span class="label">分子式:</span><span class="value">${molFormula}</span></div>
                `;
            } else {
                container.innerHTML = `<p class="placeholder">数据源: ${source}</p>`;
            }
        })
        .catch(error => {
            console.error('Update selected info error:', error);
            const container = document.querySelector('.selected-info .info-content');
            container.innerHTML = '<p class="placeholder">信息加载失败: ' + error.message + '</p>';
        });
}

function updatePathwayInfo(pathwayId) {
    fetch(`/api/pathway/${pathwayId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) return;

            const container = document.querySelector('.selected-info .info-content');

            let authorInfo = data.Author || 'N/A';
            if (Array.isArray(authorInfo)) {
                authorInfo = authorInfo.join(', ');
            }

            container.innerHTML = `
                <div class="info-item"><span class="label">通路名称:</span><span class="value">${data.Name || 'N/A'}</span></div>
                <div class="info-item"><span class="label">生物体:</span><span class="value">${data.Organism || 'N/A'}</span></div>
                <div class="info-item"><span class="label">版本:</span><span class="value">${data.Version || 'N/A'}</span></div>
                <div class="info-item"><span class="label">作者:</span><span class="value">${authorInfo}</span></div>
                <div class="info-item"><span class="label">数据源:</span><span class="value">${data['Data-Source'] || 'WikiPathways'}</span></div>
            `;
        })
        .catch(error => console.error('Update pathway info error:', error));
}

function initGraph() {
    const container = document.getElementById('graph-container');

    const options = {
        nodes: {
            font: {
                color: '#e0e0e0',
                size: 12,
                face: 'Segoe UI'
            },
            borderWidth: 2,
            shadow: true,
            scaling: {
                min: 10,
                max: 30
            }
        },
        edges: {
            width: 2,
            color: {
                color: '#4a4f5a',
                highlight: '#00bcd4'
            },
            smooth: {
                type: 'curvedCW',
                roundness: 0.2
            }
        },
        physics: {
            stabilization: {
                iterations: 100,
                fit: true
            },
            barnesHut: {
                gravitationalConstant: -8000,
                centralGravity: 0.1,
                springLength: 200,
                springConstant: 0.04
            }
        },
        layout: {
            improvedLayout: true,
            hierarchical: {
                enabled: false
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            navigationButtons: false,  // 隐藏左下角和右下角的绿色圆形按钮
            keyboard: true,
            zoomView: true,
            dragView: true
        },
        groups: {
            // 中心节点（当前选中）- 星形，颜色由节点本身决定
            center: {
                size: 30,
                borderWidth: 3,
                font: {
                    size: 14,
                    color: '#ffffff',
                    bold: true
                },
                shape: 'star'
            },
            // 药物节点
            drug: {
                color: {
                    background: '#00bcd4',
                    border: '#ffffff',
                    highlight: {
                        background: '#00acc1',
                        border: '#00bcd4'
                    }
                },
                size: 20,
                font: {
                    size: 12,
                    color: '#e0e0e0'
                },
                shape: 'dot'
            },
            // 基因节点
            gene: {
                color: {
                    background: '#4caf50',
                    border: '#ffffff',
                    highlight: {
                        background: '#388e3c',
                        border: '#4caf50'
                    }
                },
                size: 20,
                font: {
                    size: 12,
                    color: '#e0e0e0'
                },
                shape: 'dot'
            },
            // 蛋白质节点
            protein: {
                color: {
                    background: '#ff9800',
                    border: '#ffffff',
                    highlight: {
                        background: '#f57c00',
                        border: '#ff9800'
                    }
                },
                size: 20,
                font: {
                    size: 12,
                    color: '#e0e0e0'
                },
                shape: 'dot'
            },
            // 通路节点
            pathway: {
                color: {
                    background: '#9c27b0',
                    border: '#ffffff',
                    highlight: {
                        background: '#7b1fa2',
                        border: '#9c27b0'
                    }
                },
                size: 25,
                borderWidth: 2,
                font: {
                    size: 12,
                    color: '#ffffff',
                    bold: true
                },
                shape: 'box'
            },
            // 目标基因节点（星形高亮）
            target_gene: {
                color: {
                    background: '#ffffff',
                    border: '#4caf50',
                    highlight: {
                        background: '#ffffff',
                        border: '#00bcd4'
                    }
                },
                size: 30,
                borderWidth: 4,
                font: {
                    size: 14,
                    color: '#4caf50',
                    bold: true
                },
                shape: 'star'
            },
            // 目标蛋白质节点（星形高亮）
            target_protein: {
                color: {
                    background: '#ffffff',
                    border: '#ff9800',
                    highlight: {
                        background: '#ffffff',
                        border: '#00bcd4'
                    }
                },
                size: 30,
                borderWidth: 4,
                font: {
                    size: 14,
                    color: '#ff9800',
                    bold: true
                },
                shape: 'star'
            },
            more: {
                color: {
                    background: '#4a4f5a',
                    border: '#8a8f99'
                },
                size: 15,
                font: {
                    size: 11,
                    color: '#c0c0c0',
                    bold: true
                },
                shape: 'box'
            },
            cluster: {
                color: {
                    background: '#3a4050',
                    border: '#00bcd4'
                },
                size: 25,
                font: {
                    size: 12,
                    color: '#e0e0e0',
                    bold: true
                },
                shape: 'box'
            }
        }
    };

    network = new vis.Network(container, { nodes, edges }, options);

    // 节点点击事件
    network.on('click', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);

            if (node) {
                if (node.group === 'more') {
                    if (confirm('有更多未显示的关系，是否加载全部？')) {
                        if (currentItemId.startsWith('CHEMBL')) {
                            loadChemblGraph(currentItemId);
                        }
                    }
                } else if (node.group === 'cluster') {
                    expandCluster();
                } else if (node.id !== currentItemId && node.group !== 'pathway') {
                    selectItem(node.id, node.label);
                }
            }
        }
    });

    network.on('doubleClick', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);

            if (node && node.group === 'cluster') {
                expandCluster();
            }
        }
    });

    network.on('hoverNode', function() {
        network.canvas.body.container.style.cursor = 'pointer';
    });

    network.on('blurNode', function() {
        network.canvas.body.container.style.cursor = 'default';
    });

    network.once('stabilized', function() {
        network.fit();
    });
}