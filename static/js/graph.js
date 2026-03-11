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

    // 确保DOM完全加载后添加控制按钮
    setTimeout(() => {
        addLayoutControls();
    }, 100);

    // 初始化placeholder
    updatePlaceholderByType();
});

// 初始化事件监听
function initEventListeners() {
    // 搜索输入框 - 实时建议
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

    // 搜索按钮点击
    document.getElementById('searchBtn').addEventListener('click', performSearch);

    // 搜索输入框回车
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // 搜索类型改变
    document.getElementById('searchType').addEventListener('change', function() {
        updatePlaceholderByType();
        updateTitlesByType();

        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('searchInput').value = '';

        // 清空图谱
        if (network) {
            nodes.clear();
            edges.clear();
            document.getElementById('graph-container').innerHTML = '<div id="graph-container"></div>';
            initGraph();
        }

        // 清空信息显示
        clearAllInfoDisplays();
    });

    // 图谱控制
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

// 根据搜索类型更新placeholder
function updatePlaceholderByType() {
    const searchType = document.getElementById('searchType').value;
    const searchInput = document.getElementById('searchInput');

    switch(searchType) {
        case 'drug':
            searchInput.placeholder = '请输入药物';
            break;
        case 'gene':
            searchInput.placeholder = '请输入基因';
            break;
        case 'protein':
            searchInput.placeholder = '请输入蛋白质';
            break;
    }
}

// 根据搜索类型更新标题
function updateTitlesByType() {
    const searchType = document.getElementById('searchType').value;
    const molecularTitle = document.getElementById('molecular-title');
    const detailsTitle = document.getElementById('details-title');
    const molIdLabel = document.getElementById('mol-id-label');

    switch(searchType) {
        case 'drug':
            molecularTitle.textContent = '分子结构信息';
            detailsTitle.textContent = '相互作用详情';
            if (molIdLabel) molIdLabel.textContent = 'DrugBank IDs:';
            break;
        case 'gene':
            molecularTitle.textContent = '基因信息';
            detailsTitle.textContent = '基因列表';
            if (molIdLabel) molIdLabel.textContent = '基因类型:';
            break;
        case 'protein':
            molecularTitle.textContent = '蛋白质信息';
            detailsTitle.textContent = '蛋白质列表';
            if (molIdLabel) molIdLabel.textContent = '蛋白质类型:';
            break;
    }
}

// 清空所有信息显示
function clearAllInfoDisplays() {
    const searchType = document.getElementById('searchType').value;

    // 清空分子信息
    document.getElementById('mol-name').textContent = '-';
    document.getElementById('mol-drugbank-ids').textContent = '-';
    document.getElementById('mol-cas').textContent = '-';
    document.getElementById('mol-uni').textContent = '-';
    document.getElementById('mol-state').textContent = '-';
    document.getElementById('mol-groups').textContent = '-';

    const descElement = document.getElementById('mol-description');
    if (descElement) {
        const p = descElement.querySelector('p') || document.createElement('p');
        if (searchType === 'drug') {
            p.textContent = '请选择一个药物查看分子结构信息';
        } else if (searchType === 'gene') {
            p.textContent = '请选择一个基因查看详细信息';
        } else if (searchType === 'protein') {
            p.textContent = '请选择一个蛋白质查看详细信息';
        }
        p.style.whiteSpace = 'normal';
        p.style.color = '#8a8f99';
        if (!descElement.querySelector('p')) descElement.appendChild(p);
    }

    // 清空相互作用列表
    const interactionsList = document.getElementById('interactionsList');
    if (searchType === 'drug') {
        interactionsList.innerHTML = '<p class="placeholder">请选择一个药物查看相互作用详情</p>';
    } else if (searchType === 'gene') {
        interactionsList.innerHTML = '<p class="placeholder">请选择一个基因查看通路中的节点</p>';
    } else if (searchType === 'protein') {
        interactionsList.innerHTML = '<p class="placeholder">请选择一个蛋白质查看通路中的节点</p>';
    }

    // 清空当前选择信息
    const selectedInfo = document.querySelector('.selected-info .info-content');
    if (selectedInfo) {
        selectedInfo.innerHTML = '<p class="placeholder">请选择一个项目</p>';
    }
}

// 添加布局控制按钮 - 只保留聚类、展开全部、重置功能
function addLayoutControls() {
    const controls = document.querySelector('.graph-controls');
    if (!controls) return;

    // 清除现有按钮（避免重复添加）
    const existingButtons = controls.querySelectorAll('button:not(#zoomIn):not(#zoomOut):not(#fitGraph)');
    existingButtons.forEach(btn => btn.remove());

    // 聚类按钮
    const clusterBtn = document.createElement('button');
    clusterBtn.id = 'clusterBtn';
    clusterBtn.innerHTML = '聚类';
    clusterBtn.title = '将相关节点聚合成簇';
    clusterBtn.onclick = clusterGraph;
    controls.appendChild(clusterBtn);

    // 展开全部按钮
    const expandBtn = document.createElement('button');
    expandBtn.id = 'expandBtn';
    expandBtn.innerHTML = '展开全部';
    expandBtn.title = '展开所有聚类节点';
    expandBtn.onclick = expandAllClusters;
    controls.appendChild(expandBtn);

    // 重置视图按钮
    const resetBtn = document.createElement('button');
    resetBtn.id = 'resetViewBtn';
    resetBtn.innerHTML = '重置';
    resetBtn.title = '重置视图';
    resetBtn.onclick = resetView;
    controls.appendChild(resetBtn);

    console.log('布局控制按钮已添加');
}

// 聚类函数
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

    // 检查是否有相关节点
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

    // 清除之前的聚类记录
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

    if (relatedNodes.length === 0) {
        showNotification('没有可聚类的相关节点');
        return;
    }

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
                border: '#00bcd4',
                highlight: {
                    background: '#4a5060',
                    border: '#00bcd4'
                }
            },
            font: {
                color: '#e0e0e0',
                size: 12,
                bold: true
            },
            title: `包含 ${relatedNodes.length} 个相关药物\n点击展开查看`
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
        showNotification('聚类失败: ' + e.message);
    }
}

// 展开聚类
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

// 展开所有聚类
function expandAllClusters() {
    expandCluster();
}

// 重置视图
function resetView() {
    if (!network) return;

    console.log('重置视图');

    // 展开所有聚类
    expandCluster();

    // 重新启用物理引擎
    network.setOptions({
        physics: {
            enabled: true,
            stabilization: {
                enabled: true,
                iterations: 100,
                fit: true
            }
        }
    });

    // 适应视图
    setTimeout(() => {
        network.fit({
            animation: {
                duration: 500,
                easingFunction: 'easeInOutQuad'
            }
        });
    }, 600);

    showNotification('视图已重置');
}

// 显示通知
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'graph-notification';
    notification.textContent = message;

    document.querySelector('.graph-card').appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 2000);
}

// 获取搜索建议
function getSuggestions(query) {
    const searchType = document.getElementById('searchType').value;

    fetch(`/api/suggestions?type=${searchType}&q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => displaySuggestions(data))
        .catch(error => console.error('Suggestions error:', error));
}

// 显示搜索建议
function displaySuggestions(suggestions) {
    const container = document.getElementById('searchResults');

    if (suggestions.length === 0) {
        container.innerHTML = '<div class="result-item">无匹配结果</div>';
        return;
    }

    let html = '<div class="suggestions-header">搜索建议</div>';

    suggestions.forEach(suggestion => {
        let matchInfo = '';
        let icon = '';
        let typeColor = '';

        if (suggestion.type === 'drug') {
            icon = '💊';
            typeColor = '#00bcd4';
            if (suggestion.matched_field === 'name') {
                matchInfo = '<span class="match-badge name-match">名称匹配</span>';
            } else {
                matchInfo = '<span class="match-badge id-match">ID: ' + (suggestion.matched_value || '') + '</span>';
            }
        } else if (suggestion.type === 'gene') {
            icon = '🧬';
            typeColor = '#4caf50';
            matchInfo = '<span class="match-badge" style="background: #1e3a2a; color: #4caf50;">基因</span>';
        } else if (suggestion.type === 'protein') {
            icon = '⚛️';
            typeColor = '#ff9800';
            matchInfo = '<span class="match-badge" style="background: #3a2a1e; color: #ff9800;">蛋白质</span>';
        }

        // 安全地处理字符串
        const safeName = (suggestion.name || '').replace(/['"]/g, '');
        const safePathwayName = (suggestion.pathway_name || '').replace(/['"]/g, '');
        const safeXref = (suggestion.xref || '').replace(/['"]/g, '');
        const safeOrganism = (suggestion.organism || '').replace(/['"]/g, '');
        const safeDescription = (suggestion.description || '').replace(/['"]/g, '');

        // 构建HTML字符串
        html += '<div class="result-item suggestion-item" onclick="selectItem(\'' + suggestion.id + '\', \'' + (suggestion.node_label || safeName).replace(/'/g, "\\'") + '\')">';
        html += '<div class="name" style="color: ' + typeColor + ';">' + icon + ' ' + safeName + '</div>';
        html += '<div class="type">' + suggestion.type.toUpperCase() + ' ' + matchInfo + '</div>';

        if (suggestion.pathway_name) {
            html += '<div class="desc" style="color: #9c27b0; font-size: 11px;">通路: ' + safePathwayName + '</div>';
        }

        if (suggestion.organism) {
            html += '<div class="desc" style="color: #8a8f99; font-size: 10px;">' + safeOrganism + '</div>';
        }

        if (suggestion.xref) {
            html += '<div class="desc" style="color: #8a8f99; font-size: 10px; font-family: monospace;">' + safeXref + '</div>';
        }

        html += '<div class="desc">' + safeDescription + '</div>';
        html += '</div>';
    });

    container.innerHTML = html;
}

// 执行搜索
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

// 显示搜索结果
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

        // 安全地处理字符串
        const safeName = (result.name || '').replace(/['"]/g, '');
        const safePathwayName = (result.pathway_name || '').replace(/['"]/g, '');
        const safeXref = (result.xref || '').replace(/['"]/g, '');
        const safeOrganism = (result.organism || '').replace(/['"]/g, '');
        const safeDescription = (result.description || '').replace(/['"]/g, '');

        // 构建HTML字符串
        html += '<div class="result-item" onclick="selectItem(\'' + result.id + '\', \'' + (result.node_label || safeName).replace(/'/g, "\\'") + '\')">';
        html += '<div class="name" style="color: ' + typeColor + ';">' + icon + ' ' + safeName + '</div>';

        if (result.pathway_name) {
            html += '<div class="desc" style="color: #9c27b0;">通路: ' + safePathwayName + '</div>';
        }

        if (result.organism) {
            html += '<div class="desc" style="color: #8a8f99;">' + safeOrganism + '</div>';
        }

        if (result.xref) {
            html += '<div class="desc" style="color: #8a8f99; font-size: 11px;">' + safeXref + '</div>';
        }

        html += '<div class="desc">' + safeDescription + '</div>';
        html += '</div>';
    });

    container.innerHTML = html;
}

// 选择项目
function selectItem(itemId, itemLabel) {
    console.log('选择项目 - ID:', itemId, '标签:', itemLabel);

    if (!itemId) {
        console.error('项目ID为空');
        showNotification('无效的项目ID');
        return;
    }

    currentItemId = itemId;
    currentTargetLabel = itemLabel || '';

    // 更新选中状态
    document.querySelectorAll('.result-item').forEach(item => {
        item.classList.remove('selected');
    });

    // 查找并高亮选中的项
    const selectedItem = Array.from(document.querySelectorAll('.result-item')).find(item => {
        const onclick = item.getAttribute('onclick');
        return onclick && onclick.includes(itemId);
    });

    if (selectedItem) {
        selectedItem.classList.add('selected');
        console.log('已高亮选中项');
    } else {
        console.warn('未找到对应的选中项元素');
    }

    const searchType = document.getElementById('searchType').value;
    console.log('搜索类型:', searchType);

    // 清空之前的图谱和显示
    if (network) {
        nodes.clear();
        edges.clear();
    }

    // 根据类型加载不同内容
    if (searchType === 'drug') {
        console.log('加载药物图谱:', itemId);
        loadDrugGraph(itemId);
        loadMolecularInfo(itemId);
        updateSelectedInfo(itemId);
    } else if (searchType === 'gene' || searchType === 'protein') {
        console.log('加载通路图谱 - 通路ID:', itemId, '目标节点:', currentTargetLabel);
        const pathwayId = String(itemId);
        loadPathwayGraph(pathwayId, currentTargetLabel);
        updatePathwayInfo(pathwayId);
        clearMolecularInfoForGene();
    } else {
        console.error('未知的搜索类型:', searchType);
    }
}

// 初始化图谱 - 使用默认布局
function initGraph() {
    const container = document.getElementById('graph-container');

    const options = {
        nodes: {
            font: {
                color: '#e0e0e0',
                size: 12,
                face: 'Segoe UI',
                strokeWidth: 0
            },
            borderWidth: 2,
            shadow: true,
            scaling: {
                min: 10,
                max: 30,
                label: {
                    min: 8,
                    max: 14,
                    maxVisible: 20
                }
            }
        },
        edges: {
            width: 2,
            color: {
                color: '#4a4f5a',
                highlight: '#00bcd4',
                hover: '#00bcd4',
                opacity: 0.8
            },
            smooth: {
                type: 'curvedCW',
                roundness: 0.2
            },
            arrows: {
                to: {
                    enabled: false
                }
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
                springConstant: 0.04,
                damping: 0.09
            }
        },
        layout: {
            improvedLayout: true,
            hierarchical: {
                enabled: false  // 始终使用默认布局
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            navigationButtons: true,
            keyboard: true,
            zoomView: true,
            dragView: true
        },
        groups: {
            // 药物图谱组
            center: {
                color: {
                    background: '#00bcd4',
                    border: '#ffffff',
                    highlight: {
                        background: '#00acc1',
                        border: '#ffffff'
                    }
                },
                size: 30,
                borderWidth: 3,
                font: {
                    size: 14,
                    color: '#ffffff',
                    bold: true
                },
                shape: 'star'
            },
            related: {
                color: {
                    background: '#2a2f3a',
                    border: '#4a4f5a',
                    highlight: {
                        background: '#3a3f4a',
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
            // 通路图谱组
            pathway: {
                color: {
                    background: '#9c27b0',
                    border: '#ffffff',
                    highlight: {
                        background: '#7b1fa2',
                        border: '#ffffff'
                    }
                },
                size: 30,
                borderWidth: 3,
                font: {
                    size: 14,
                    color: '#ffffff',
                    bold: true
                },
                shape: 'box'
            },
            gene: {
                color: {
                    background: '#4caf50',
                    border: '#ffffff',
                    highlight: {
                        background: '#388e3c',
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
            protein: {
                color: {
                    background: '#ff9800',
                    border: '#ffffff',
                    highlight: {
                        background: '#f57c00',
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
            // 目标节点组（基因/蛋白质的搜索目标使用星形）
            target_gene: {
                color: {
                    background: '#4caf50',
                    border: '#ffffff',
                    highlight: {
                        background: '#388e3c',
                        border: '#00bcd4'
                    }
                },
                size: 30,
                borderWidth: 4,
                font: {
                    size: 14,
                    color: '#ffffff',
                    bold: true
                },
                shape: 'star'
            },
            target_protein: {
                color: {
                    background: '#ff9800',
                    border: '#ffffff',
                    highlight: {
                        background: '#f57c00',
                        border: '#00bcd4'
                    }
                },
                size: 30,
                borderWidth: 4,
                font: {
                    size: 14,
                    color: '#ffffff',
                    bold: true
                },
                shape: 'star'
            },
            more: {
                color: {
                    background: '#4a4f5a',
                    border: '#8a8f99',
                    highlight: {
                        background: '#5a5f6a',
                        border: '#00bcd4'
                    }
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
                    border: '#00bcd4',
                    highlight: {
                        background: '#4a5060',
                        border: '#00bcd4'
                    }
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
                    if (confirm('有更多未显示的相互作用关系，是否加载全部？')) {
                        loadFullDrugGraph(currentItemId);
                    }
                } else if (node.group === 'related') {
                    selectItem(nodeId, node.label);
                } else if (node.group === 'cluster') {
                    expandCluster();
                } else if (node.group === 'gene' || node.group === 'protein' ||
                           node.group === 'target_gene' || node.group === 'target_protein') {
                    showGeneProteinDetails(node);
                    highlightNode(nodeId);
                } else if (node.group === 'pathway') {
                    updatePathwayInfo(currentItemId);
                }
            }
        }
    });

    // 双击节点
    network.on('doubleClick', function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);

            if (node) {
                if (node.group === 'more') {
                    loadFullDrugGraph(currentItemId);
                } else if (node.group === 'cluster') {
                    expandCluster();
                } else if (node.group === 'gene' || node.group === 'protein' ||
                           node.group === 'target_gene' || node.group === 'target_protein') {
                    network.focus(nodeId, {
                        scale: 2.0,
                        animation: true
                    });
                }
            }
        }
    });

    // 节点悬停
    network.on('hoverNode', function(params) {
        const node = nodes.get(params.node);
        if (node) {
            if (node.group === 'more' || node.group === 'cluster') {
                network.canvas.body.container.style.cursor = 'pointer';
            } else {
                network.canvas.body.container.style.cursor = 'pointer';
            }
        }
    });

    network.on('blurNode', function(params) {
        network.canvas.body.container.style.cursor = 'default';
    });

    network.once('stabilized', function() {
        network.fit();
    });
}

// 高亮节点
function highlightNode(nodeId) {
    network.selectNodes([nodeId]);
    network.focus(nodeId, {
        scale: 1.5,
        animation: {
            duration: 500,
            easingFunction: 'easeInOutQuad'
        }
    });
}

// 显示基因/蛋白质详细信息
function showGeneProteinDetails(node) {
    const container = document.getElementById('interactionsList');
    const detailsTitle = document.getElementById('details-title');

    const isTarget = node.group === 'target_gene' || node.group === 'target_protein';
    const typeIcon = node.group.includes('gene') ? '🧬' : '⚛️';
    const typeName = node.group.includes('gene') ? '基因' : '蛋白质';
    const typeColor = node.group.includes('gene') ? '#4caf50' : '#ff9800';

    // 更新标题
    if (detailsTitle) {
        detailsTitle.textContent = typeName + '详情';
    }

    // 解析标题中的信息
    let titleInfo = node.title || '';
    let dbMatch = titleInfo.match(/Database: ([^\n]+)/);
    let idMatch = titleInfo.match(/ID: ([^\n]+)/);
    let typeMatch = titleInfo.match(/Type: ([^\n]+)/);

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
                <span class="value">${typeName} (${typeMatch ? typeMatch[1] : 'N/A'})</span>
            </div>
            ${xrefInfo}
            <div class="info-item" style="margin-top: 10px;">
                <span class="label" style="width: 50px;">通路:</span>
                <span class="value" style="color: #9c27b0;">${document.querySelector('.graph-card .card-header h2')?.textContent.replace('通路图谱: ', '') || '未知'}</span>
            </div>
        </div>
    `;

    // 更新分子信息区域为基因/蛋白质信息
    updateMolecularInfoForGene(node, typeName, dbMatch, idMatch);
}

// 为基因/蛋白质更新分子信息区域
function updateMolecularInfoForGene(node, typeName, dbMatch, idMatch) {
    const searchType = document.getElementById('searchType').value;

    const molNameElement = document.getElementById('mol-name');
    const molIdElement = document.getElementById('mol-drugbank-ids');
    const molCasElement = document.getElementById('mol-cas');
    const molUniElement = document.getElementById('mol-uni');
    const molStateElement = document.getElementById('mol-state');
    const molGroupsElement = document.getElementById('mol-groups');
    const molDescElement = document.getElementById('mol-description');
    const molIdLabel = document.getElementById('mol-id-label');
    const molecularTitle = document.getElementById('molecular-title');

    if (searchType === 'gene') {
        molecularTitle.textContent = '基因信息';
        if (molIdLabel) molIdLabel.textContent = '基因类型:';
    } else if (searchType === 'protein') {
        molecularTitle.textContent = '蛋白质信息';
        if (molIdLabel) molIdLabel.textContent = '蛋白质类型:';
    }

    if (molNameElement) molNameElement.textContent = node.label;
    if (molIdElement) molIdElement.textContent = typeName;
    if (molCasElement) molCasElement.textContent = '—';
    if (molUniElement) molUniElement.textContent = '—';
    if (molStateElement) molStateElement.textContent = '—';
    if (molGroupsElement) molGroupsElement.textContent = '—';

    if (molDescElement) {
        const p = molDescElement.querySelector('p') || document.createElement('p');
        let descText = `【${typeName}信息】\n`;
        if (dbMatch && idMatch) {
            descText += `数据库: ${dbMatch[1]}\nID: ${idMatch[1]}`;
        } else {
            descText += `位于通路 ${document.querySelector('.graph-card .card-header h2')?.textContent.replace('通路图谱: ', '') || '未知'}`;
        }
        p.textContent = descText;
        p.style.whiteSpace = 'pre-line';
        p.style.color = searchType === 'gene' ? '#4caf50' : '#ff9800';
        if (!molDescElement.querySelector('p')) molDescElement.appendChild(p);
    }
}

// 清空分子信息（基因/蛋白质版本）
function clearMolecularInfoForGene() {
    const searchType = document.getElementById('searchType').value;

    document.getElementById('mol-name').textContent = '-';
    document.getElementById('mol-drugbank-ids').textContent = '-';
    document.getElementById('mol-cas').textContent = '-';
    document.getElementById('mol-uni').textContent = '-';
    document.getElementById('mol-state').textContent = '-';
    document.getElementById('mol-groups').textContent = '-';

    const descElement = document.getElementById('mol-description');
    if (descElement) {
        const p = descElement.querySelector('p') || document.createElement('p');
        if (searchType === 'gene') {
            p.textContent = '基因信息请点击图谱中的基因节点查看';
        } else {
            p.textContent = '蛋白质信息请点击图谱中的蛋白质节点查看';
        }
        p.style.whiteSpace = 'normal';
        p.style.color = '#8a8f99';
        if (!descElement.querySelector('p')) descElement.appendChild(p);
    }
}

// 加载药物图谱
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
                nodes.add(data.nodes);
            }

            if (data.edges && data.edges.length > 0) {
                edges.add(data.edges);
            }

            const graphHeader = document.querySelector('.graph-card .card-header h2');
            if (graphHeader) {
                if (data.displayed_interactions > 0) {
                    graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats">(显示 ${data.displayed_interactions} 个相互作用)</span>`;
                } else {
                    graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats no-data">(无相互作用数据)</span>`;
                }
            }

            addNodeCountHint({
                nodes: data.nodes,
                edges: data.edges,
                has_more: data.has_more,
                remaining_count: data.remaining_count
            });

            if (data.target_node_id) {
                setTimeout(() => {
                    network.selectNodes([data.target_node_id]);
                    network.focus(data.target_node_id, {
                        scale: 1.2,
                        animation: {
                            duration: 500,
                            easingFunction: 'easeInOutQuad'
                        }
                    });
                }, 500);
            }

            updateInteractionsList(data.edges);
        })
        .catch(error => {
            console.error('Load drug graph error:', error);
            document.getElementById('graph-container').innerHTML = '<div class="graph-error">加载图谱失败: ' + error.message + '</div>';
            showNotification('加载图谱失败: ' + error.message);
        });
}

// 加载完整药物图谱
function loadFullDrugGraph(drugId) {
    document.getElementById('graph-container').innerHTML = '<div class="graph-loading">加载全部相互作用中...</div>';

    clusteredNodes.clear();
    clusterInfo = {
        clusterId: null,
        childNodes: []
    };

    fetch(`/api/graph/${drugId}?full=true`)
        .then(response => response.json())
        .then(data => {
            if (data.error) return;

            initGraph();
            nodes.clear();
            edges.clear();

            if (data.nodes) nodes.add(data.nodes);
            if (data.edges) edges.add(data.edges);

            const graphHeader = document.querySelector('.graph-card .card-header h2');
            if (graphHeader && data.drug_name) {
                graphHeader.innerHTML = `药物相互作用图谱: ${data.drug_name} <span class="graph-stats">(全部 ${data.total_interactions} 个相互作用)</span>`;
            }

            if (data.center_id) {
                network.focus(data.center_id, {
                    scale: 1.2,
                    animation: true
                });
            }

            updateInteractionsList(data.edges);
        });
}

// 加载通路图谱
function loadPathwayGraph(pathwayId, targetNodeLabel) {
    if (!pathwayId) {
        console.error('通路ID为空');
        showNotification('无效的通路ID');
        return;
    }

    console.log('加载通路图谱 - 通路ID:', pathwayId, '目标节点:', targetNodeLabel);
    document.getElementById('graph-container').innerHTML = '<div class="graph-loading">加载通路图谱中...</div>';

    let url = '/api/pathway/graph/' + encodeURIComponent(pathwayId);
    if (targetNodeLabel) {
        url += '?target=' + encodeURIComponent(targetNodeLabel);
    }

    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP error! status: ' + response.status);
            }
            return response.json();
        })
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
                // 修改目标节点的group为target_gene或target_protein
                const modifiedNodes = data.nodes.map(node => {
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
                has_more: false,
                gene_count: data.gene_count,
                protein_count: data.protein_count
            });

            if (data.target_node_id) {
                setTimeout(() => {
                    network.selectNodes([data.target_node_id]);
                    network.focus(data.target_node_id, {
                        scale: 1.5,
                        animation: {
                            duration: 500,
                            easingFunction: 'easeInOutQuad'
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
                            duration: 500,
                            easingFunction: 'easeInOutQuad'
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

// 添加节点计数提示
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
        hintText += `<span class="more-hint"> | 还有 ${data.remaining_count} 个未显示 (双击"更多"节点查看)</span>`;
    }

    nodeCountHint.innerHTML = hintText;
    document.querySelector('.graph-card').appendChild(nodeCountHint);
}

// 更新药物相互作用列表
function updateInteractionsList(edges) {
    const container = document.getElementById('interactionsList');
    const detailsTitle = document.getElementById('details-title');

    if (detailsTitle) {
        detailsTitle.textContent = '相互作用详情';
    }

    if (!edges || edges.length === 0) {
        container.innerHTML = '<p class="placeholder">该药物暂无相互作用数据</p>';
        return;
    }

    let html = '';
    let displayedCount = 0;

    edges.forEach(edge => {
        if (edge.to && edge.to.toString().startsWith('more_')) {
            return;
        }

        const targetNode = nodes.get(edge.to);
        if (!targetNode) return;

        if (clusteredNodes.has(targetNode.id)) {
            return;
        }

        displayedCount++;
        const drugName = targetNode.label || '未知药物';
        const description = edge.title || '相互作用描述';

        html += `
            <div class="interaction-item">
                <div class="drug-name">💊 ${drugName}</div>
                <div class="description">${description}</div>
            </div>
        `;
    });

    if (displayedCount === 0) {
        if (clusterInfo.clusterId) {
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

// 更新通路节点列表
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

    // 先找出目标节点
    if (targetNodeId) {
        targetNode = nodes.find(n => n.id === targetNodeId);
    }

    // 显示目标节点（如果有）
    if (targetNode) {
        const icon = targetNode.type === 'gene' ? '🧬' : '⚛️';
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

    // 显示其他节点
    html += '<div style="margin-top: 10px;">';
    nodes.forEach(node => {
        if (node.group === 'pathway' || node.id === targetNodeId) return;

        if (node.type === 'gene') {
            geneCount++;
            html += `
                <div class="interaction-item">
                    <div class="drug-name" style="color: #4caf50;">🧬 ${node.label}</div>
                    <div class="description">基因节点</div>
                </div>
            `;
        } else if (node.type === 'protein') {
            proteinCount++;
            html += `
                <div class="interaction-item">
                    <div class="drug-name" style="color: #ff9800;">⚛️ ${node.label}</div>
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

// 加载分子信息（药物专用）
function loadMolecularInfo(drugId) {
    fetch(`/api/drug/${drugId}/molecular_info`)
        .then(response => response.json())
        .then(data => {
            if (data.error) return;

            document.getElementById('mol-name').textContent = data.name || '-';

            const drugbankElement = document.getElementById('mol-drugbank-ids');
            if (drugbankElement) {
                drugbankElement.textContent = data.drugbank_ids ? data.drugbank_ids.join(', ') : '-';
            }

            document.getElementById('mol-cas').textContent = data.cas_number || '-';
            document.getElementById('mol-uni').textContent = data.uni || '-';
            document.getElementById('mol-state').textContent = data.state || '-';
            document.getElementById('mol-groups').textContent = data.groups ? data.groups.join(', ') : '-';

            const descElement = document.getElementById('mol-description');
            if (descElement) {
                const p = descElement.querySelector('p') || document.createElement('p');
                p.textContent = data.description || '暂无描述';
                p.style.whiteSpace = 'normal';
                p.style.color = '#e0e0e0';
                if (!descElement.querySelector('p')) descElement.appendChild(p);
            }

            // 更新标题
            document.getElementById('molecular-title').textContent = '分子结构信息';
            document.getElementById('details-title').textContent = '相互作用详情';
            document.getElementById('mol-id-label').textContent = 'DrugBank IDs:';
        })
        .catch(error => console.error('Load molecular info error:', error));
}

// 更新当前选择信息（药物专用）
function updateSelectedInfo(drugId) {
    fetch(`/api/drug/${drugId}`)
        .then(response => response.json())
        .then(data => {
            const container = document.querySelector('.selected-info .info-content');
            if (data.error) {
                container.innerHTML = '<p class="placeholder">信息加载失败</p>';
                return;
            }

            let groups = data.groups ? data.groups.join(', ') : 'N/A';
            let drugbankIds = data.drugbank_ids ? data.drugbank_ids.join(', ') : 'N/A';

            container.innerHTML = `
                <div class="info-item"><span class="label">名称:</span><span class="value">${data.name || 'N/A'}</span></div>
                <div class="info-item"><span class="label">DrugBank IDs:</span><span class="value" style="word-break: break-all;">${drugbankIds}</span></div>
                <div class="info-item"><span class="label">CAS号:</span><span class="value">${data.cas_number || 'N/A'}</span></div>
                <div class="info-item"><span class="label">UNI:</span><span class="value">${data.uni || 'N/A'}</span></div>
                <div class="info-item"><span class="label">状态:</span><span class="value">${data.state || 'N/A'}</span></div>
                <div class="info-item"><span class="label">分组:</span><span class="value">${groups}</span></div>
            `;
        })
        .catch(error => console.error('Update selected info error:', error));
}

// 更新通路信息到当前选择区域
function updatePathwayInfo(pathwayId) {
    fetch(`/api/pathway/${pathwayId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) return;

            const container = document.querySelector('.selected-info .info-content');

            // 提取作者信息
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
                <div class="info-item"><span class="label">修改时间:</span><span class="value">${data['Last-Modified'] || 'N/A'}</span></div>
            `;

            // 如果有描述信息，显示在分子信息区域
            if (data.Comment && data.Comment.content) {
                const descElement = document.getElementById('mol-description');
                if (descElement) {
                    const p = descElement.querySelector('p') || document.createElement('p');
                    p.textContent = data.Comment.content.substring(0, 200) + '...';
                    p.style.whiteSpace = 'normal';
                    p.style.color = '#9c27b0';
                    if (!descElement.querySelector('p')) descElement.appendChild(p);
                }
            }
        })
        .catch(error => console.error('Update pathway info error:', error));
}